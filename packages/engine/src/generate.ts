import {
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFOperator,
  PDFOperatorNames,
  PDFPage,
  endMarkedContent,
  beginText,
  endText,
  setFontAndSize,
  setTextMatrix,
  showText,
  setFillingRgbColor,
  pushGraphicsState,
  popGraphicsState,
  rectangle,
  fill,
  moveTo,
  lineTo,
  stroke,
  setStrokingRgbColor,
  setLineWidth,
  setLineCap,
  setLineJoin,
  LineCapStyle,
  LineJoinStyle,
  appendBezierCurve,
  closePath,
} from 'pdf-lib';
import { FontRegistry, createSubsetter, type Subsetter } from './pdf/fonts';
import { detectDir, familyKey, loadFontAsset, shapeLine, wrapText, type FamilyFonts, type FontAsset, type ShapedLine } from './text/shaper';
import { isChecked, resolveValue, type ValueContext } from './values';
import { stampBox } from './stamp';
import { buildDocx } from './docx';
import type {
  BilingualItem,
  Catalog,
  CatalogEntry,
  CheckItem,
  CompanyConfig,
  Dir,
  FieldRegistry,
  FontFamily,
  GeneratedDocument,
  GenerationWarning,
  PhotoEntry,
  GenerateOptions,
  PhotoItem,
  Placement,
  StampItem,
  ProjectFields,
  SlotGeometry,
  TextItem,
  TextStyle,
} from './types';

export interface EngineAssets {
  loadFont(file: string): Promise<Uint8Array>;
  loadTemplate(key: string, version: number): Promise<Uint8Array>;
  loadSubsetWasm(): Promise<Uint8Array>;
  /** Load a project photo (already normalised to JPEG/PNG by the app). */
  loadImage?(path: string): Promise<Uint8Array>;
  /** Company stamp + signature PNG (kept in private storage, never bundled). */
  loadStamp?(): Promise<Uint8Array>;
  /** Editable Word template (templates/dist/<key>.docx) for Word-based templates. */
  loadDocxTemplate?(key: string, version: number): Promise<Uint8Array>;
}

const FAMILY_FILES: Record<string, { arabic: string; latin: string }> = {
  sans: { arabic: 'NotoSansArabic_400Regular.ttf', latin: 'Carlito_400Regular.ttf' },
  'sans-bold': { arabic: 'NotoSansArabic_700Bold.ttf', latin: 'Carlito_700Bold.ttf' },
  naskh: { arabic: 'NotoNaskhArabic_400Regular.ttf', latin: 'Carlito_400Regular.ttf' },
  'naskh-bold': { arabic: 'NotoNaskhArabic_700Bold.ttf', latin: 'Carlito_700Bold.ttf' },
  kufi: { arabic: 'NotoKufiArabic_400Regular.ttf', latin: 'Carlito_400Regular.ttf' },
  'kufi-bold': { arabic: 'NotoKufiArabic_700Bold.ttf', latin: 'Carlito_700Bold.ttf' },
  carlito: { arabic: 'NotoSansArabic_400Regular.ttf', latin: 'Carlito_400Regular.ttf' },
  'carlito-bold': { arabic: 'NotoSansArabic_700Bold.ttf', latin: 'Carlito_700Bold.ttf' },
  din: { arabic: 'Cairo_400Regular.ttf', latin: 'Cairo_400Regular.ttf' },
  'din-bold': { arabic: 'Cairo_700Bold.ttf', latin: 'Cairo_700Bold.ttf' },
  tajawal: { arabic: 'Tajawal_400Regular.ttf', latin: 'Tajawal_400Regular.ttf' },
  'tajawal-bold': { arabic: 'Tajawal_700Bold.ttf', latin: 'Tajawal_700Bold.ttf' },
  amiri: { arabic: 'Amiri_400Regular.ttf', latin: 'Amiri_400Regular.ttf' },
  'amiri-bold': { arabic: 'Amiri_700Bold.ttf', latin: 'Amiri_700Bold.ttf' },
};

export const FONT_FILES = [...new Set(Object.values(FAMILY_FILES).flatMap((f) => [f.arabic, f.latin]))];

type Rect = [number, number, number, number];

interface DrawCtx {
  placements: Placement[];
  pageIndex: number;
  doc: PDFDocument;
  page: PDFPage;
  pageHeight: number;
  fonts: FontRegistry;
  warnings: GenerationWarning[];
}

export class Engine {
  private assetsCache = new Map<string, Promise<FontAsset>>();
  private subsetter: Subsetter | null = null;
  private templateCache = new Map<string, Promise<Uint8Array>>();
  private stampCache: Promise<Uint8Array> | undefined;

  private constructor(
    private assets: EngineAssets,
    readonly registry: FieldRegistry,
    readonly company: CompanyConfig,
    readonly catalog: Catalog,
  ) {}

  static async create(assets: EngineAssets, registry: FieldRegistry, company: CompanyConfig, catalog: Catalog): Promise<Engine> {
    const e = new Engine(assets, registry, company, catalog);
    try {
      e.subsetter = await createSubsetter(await assets.loadSubsetWasm());
    } catch (err) {
      // still correct output, just larger files (whole fonts embedded)
      console.warn('Font subsetter unavailable, embedding full fonts:', err);
      e.subsetter = null;
    }
    return e;
  }

  entry(key: string): CatalogEntry {
    const t = this.catalog.templates.find((x) => x.definition.key === key);
    if (!t) throw new Error(`Unknown template: ${key}`);
    return t;
  }

  private font(file: string): Promise<FontAsset> {
    let p = this.assetsCache.get(file);
    if (!p) {
      p = this.assets.loadFont(file).then((b) => loadFontAsset(file.replace(/\.ttf$/, ''), b));
      this.assetsCache.set(file, p);
    }
    return p;
  }

  async family(family: FontFamily, bold?: boolean): Promise<FamilyFonts> {
    const spec = FAMILY_FILES[familyKey(family, bold)] ?? FAMILY_FILES.sans;
    const [arabic, latin] = await Promise.all([this.font(spec.arabic), this.font(spec.latin)]);
    return { arabic, latin };
  }

  private template(key: string, version: number) {
    const k = `${key}@${version}`;
    let p = this.templateCache.get(k);
    if (!p) {
      p = this.assets.loadTemplate(key, version);
      this.templateCache.set(k, p);
    }
    return p;
  }

  async generate(templateKey: string, fields: ProjectFields, meta: GenerateOptions = {}): Promise<GeneratedDocument> {
    const { definition, layout } = this.entry(templateKey);
    const base = await this.template(definition.key, definition.version);
    const doc = await PDFDocument.load(base, { updateMetadata: false });
    const fonts = new FontRegistry(doc);
    const warnings: GenerationWarning[] = [];
    const placements: Placement[] = [];
    const ctx: ValueContext = { fields, registry: this.registry, company: this.company };
    const pages = doc.getPages();
    if (pages.length !== layout.pageCount) throw new Error(`Template ${templateKey}: base PDF page count mismatch`);

    for (const item of definition.fields) {
      const slot = layout.slots[item.slot];
      if (!slot) throw new Error(`Template ${templateKey}: unknown slot ${item.slot}`);
      const page = pages[slot.page];
      const dctx: DrawCtx = { doc, page, pageHeight: page.getHeight(), fonts, warnings, placements, pageIndex: slot.page };
      if ('stamp' in item) {
        if (meta.stamp) await this.drawStamp(dctx, slot, item);
      } else if ('check' in item) this.drawCheck(dctx, slot, item, fields);
      else if ('photo' in item) await this.drawPhoto(dctx, slot, item, fields);
      else if ('photoText' in item) {
        const list = (fields[item.photoText.field] as PhotoEntry[] | undefined) ?? [];
        const entry = list[item.photoText.index];
        const text = entry?.[item.photoText.prop]?.trim() ?? '';
        if (text) await this.drawText(dctx, slot, text, item, item.slot);
      } else if ('en' in item && 'ar' in item) {
        await this.drawBilingual(dctx, slot, item, resolveValue(item.en, ctx), resolveValue(item.ar, ctx));
      } else {
        const text = resolveValue((item as TextItem).value, ctx);
        if (text) await this.drawText(dctx, slot, text, item as TextItem, item.slot);
      }
    }

    if (definition.trimEmptyPhotoPages) {
      const { field, slotsPerPage } = definition.trimEmptyPhotoPages;
      const n = ((fields[field] as PhotoEntry[] | undefined) ?? []).filter((p) => p?.path).length;
      // no photos at all: keep the complete blank form
      let keep = n === 0 ? slotsPerPage.length : 1;
      let cum = slotsPerPage[0] ?? 0;
      while (keep < slotsPerPage.length && cum < n) cum += slotsPerPage[keep++];
      for (let i = doc.getPageCount() - 1; i >= keep; i--) doc.removePage(i);
    }

    fonts.finalize(this.subsetter);
    doc.setTitle(meta.title ?? definition.name);
    doc.setAuthor('ACAD Engineering Consultants');
    doc.setCreator('ACAD Document Generator');
    doc.setProducer('ACAD Document Generator');
    doc.setSubject(definition.name);
    doc.setKeywords([definition.key, `v${definition.version}`]);
    const now = new Date();
    doc.setCreationDate(now);
    doc.setModificationDate(now);
    const bytes = await doc.save({ useObjectStreams: true });
    return { format: 'pdf', templateKey, templateVersion: definition.version, bytes, pageCount: doc.getPageCount(), warnings, placements };
  }

  // ------------------------------------------------------------------ text
  private padded(slot: SlotGeometry, style: TextStyle): Rect {
    const [pl, pt, pr, pb] = style.padding ?? [3, 1, 3, 1];
    const [x0, y0, x1, y1] = slot.rect;
    return [x0 + pl, y0 + pt, x1 - pr, y1 - pb];
  }

  private async drawText(d: DrawCtx, slot: SlotGeometry, text: string, style: TextStyle, slotName: string) {
    const fam = await this.family(style.font ?? 'sans', style.bold);
    if (style.knockoutSlot) {
      const [x0, y0, x1, y1] = slot.rect;
      this.knockout(d, x0, y0, x1 - x0, y1 - y0);
    }
    const dir: Dir = !style.dir || style.dir === 'auto' ? detectDir(text, 'rtl') : style.dir;
    const inner = this.padded(slot, style);
    const innerW = inner[2] - inner[0];
    const innerH = inner[3] - inner[1];
    const lh = style.lineHeight ?? 1.2;
    let size = style.size ?? slot.size ?? 11;
    const minSize = style.minSize ?? Math.min(6.5, size);
    let lines: ShapedLine[] = [];
    let fits = false;
    for (;;) {
      lines = style.multiline ? wrapText(text, dir, fam, size, innerW) : [shapeLine(text, dir, fam)];
      const widest = Math.max(...lines.map((l) => l.width)) * size;
      const height = lines.length === 1 ? size : lines.length * size * lh;
      fits = widest <= innerW + 0.01 && height <= innerH + size * 0.25;
      if (fits || size <= minSize) break;
      size = Math.max(minSize, size - 0.25);
    }
    if (!fits) {
      d.warnings.push({ code: 'overflow', slot: slotName, message: `Text is too long for "${slotName}" even at ${size}pt; please shorten it or review the PDF.` });
    }
    for (const l of lines) {
      if (l.missing.length) d.warnings.push({ code: 'missing_glyph', slot: slotName, message: `Unsupported characters in "${slotName}": ${l.missing.join(' ')}` });
    }
    const align = resolveAlign(style.align, dir);
    const asc = 0.8;
    let baselines: number[];
    const valign = style.valign ?? 'baseline';
    if (valign === 'baseline' && slot.baseline !== undefined && lines.length === 1 && fits) {
      baselines = [slot.baseline];
    } else if (valign === 'top' || (valign === 'baseline' && slot.baseline !== undefined && fits)) {
      const first = slot.baseline !== undefined && valign === 'baseline' ? slot.baseline : inner[1] + size * asc;
      baselines = lines.map((_, i) => first + i * size * lh);
      // keep the block inside the cell if starting at the original baseline would overflow it
      const lastBottom = baselines[baselines.length - 1] + size * 0.25;
      if (lastBottom > inner[3]) {
        const shift = Math.min(lastBottom - inner[3], baselines[0] - (inner[1] + size * asc));
        baselines = baselines.map((b) => b - Math.max(0, shift));
      }
    } else {
      const blockH = (lines.length - 1) * size * lh + size;
      const top = inner[1] + (innerH - blockH) / 2;
      baselines = lines.map((_, i) => top + size * asc + i * size * lh);
    }
    d.placements.push({ slot: slotName, page: d.pageIndex, kind: 'text', text, size });
    lines.forEach((line, i) => {
      const w = line.width * size;
      const x = align === 'right' ? inner[2] - w : align === 'center' ? inner[0] + (innerW - w) / 2 : inner[0];
      if (style.knockout) this.knockout(d, x - 1.5, baselines[i] - size * 0.85, w + 3, size * 1.15);
      this.drawLine(d, line, x, baselines[i], size, style.color);
    });
  }

  private async drawBilingual(d: DrawCtx, slot: SlotGeometry, item: BilingualItem, en: string, ar: string) {
    if (!en && !ar) return;
    if (!en || !ar) {
      // only one language supplied: place it on its own side
      const one: TextStyle = { ...item, align: en ? 'left' : 'right', dir: en ? 'ltr' : 'rtl' };
      await this.drawText(d, slot, en || ar, one, item.slot);
      return;
    }
    const fam = await this.family(item.font ?? 'sans', item.bold);
    const inner = this.padded(slot, item);
    const innerW = inner[2] - inner[0];
    const gap = item.gap ?? 12;
    let size = item.size ?? slot.size ?? 11;
    const minSize = item.minSize ?? Math.min(6.5, size);
    const lineEn = shapeLine(en, 'ltr', fam);
    const lineAr = shapeLine(ar, 'rtl', fam);
    while ((lineEn.width + lineAr.width) * size + gap > innerW && size > minSize) size = Math.max(minSize, size - 0.25);
    if ((lineEn.width + lineAr.width) * size + gap <= innerW) {
      const baseline = item.valign !== 'middle' && slot.baseline !== undefined ? slot.baseline : inner[1] + (inner[3] - inner[1] - size) / 2 + size * 0.8;
      const wEn = lineEn.width * size;
      const wAr = lineAr.width * size;
      if (item.knockout) {
        this.knockout(d, inner[0] - 1.5, baseline - size * 0.85, wEn + 3, size * 1.15);
        this.knockout(d, inner[2] - wAr - 1.5, baseline - size * 0.85, wAr + 3, size * 1.15);
      }
      this.drawLine(d, lineEn, inner[0], baseline, size, item.color);
      this.drawLine(d, lineAr, inner[2] - wAr, baseline, size, item.color);
      d.placements.push({ slot: `${item.slot} (English)`, page: d.pageIndex, kind: 'text', text: en, size });
      d.placements.push({ slot: `${item.slot} (Arabic)`, page: d.pageIndex, kind: 'text', text: ar, size });
      return;
    }
    // too long for one line: split the box and wrap each language in its own half
    const total = lineEn.width + lineAr.width;
    const enShare = Math.min(0.65, Math.max(0.35, lineEn.width / total));
    const mid = inner[0] + (innerW - gap) * enShare;
    const enSlot: SlotGeometry = { ...slot, rect: [slot.rect[0], slot.rect[1], mid, slot.rect[3]] };
    const arSlot: SlotGeometry = { ...slot, rect: [mid + gap, slot.rect[1], slot.rect[2], slot.rect[3]] };
    await this.drawText(d, enSlot, en, { ...item, align: 'left', dir: 'ltr', multiline: true, valign: 'middle' }, `${item.slot} (English)`);
    await this.drawText(d, arSlot, ar, { ...item, align: 'right', dir: 'rtl', multiline: true, valign: 'middle' }, `${item.slot} (Arabic)`);
  }

  private knockout(d: DrawCtx, x: number, yTop: number, w: number, h: number) {
    d.page.pushOperators(
      pushGraphicsState(),
      setFillingRgbColor(1, 1, 1),
      rectangle(x, d.pageHeight - yTop - h, w, h),
      fill(),
      popGraphicsState(),
    );
  }

  private drawLine(d: DrawCtx, line: ShapedLine, x: number, baselineTop: number, size: number, color?: [number, number, number]) {
    if (!line.glyphs.length) return;
    const y = d.pageHeight - baselineTop;
    const c = color ?? [0, 0, 0];
    // ActualText gives extractors the logical Arabic string instead of visual-order glyphs
    const span = d.doc.context.obj({ ActualText: PDFHexString.fromText(line.text) });
    const ops = [
      PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [PDFName.of('Span'), span as unknown as PDFName]),
      pushGraphicsState(),
      setFillingRgbColor(c[0], c[1], c[2]),
      beginText(),
    ];
    let current: string | null = null;
    for (const g of line.glyphs) {
      if (g.gid === 0 && !g.text.trim()) continue;
      const ef = d.fonts.get(g.font);
      ef.use(g.gid, g.text);
      if (current !== ef.resourceName) {
        d.fonts.attach(d.page, ef);
        ops.push(setFontAndSize(ef.resourceName, size));
        current = ef.resourceName;
      }
      ops.push(setTextMatrix(1, 0, 0, 1, round(x + (g.x + g.dx) * size), round(y + g.dy * size)));
      ops.push(showText(PDFHexString.of(g.gid.toString(16).padStart(4, '0'))));
    }
    ops.push(endText(), popGraphicsState(), endMarkedContent());
    d.page.pushOperators(...ops);
  }

  // ------------------------------------------------------------------ marks
  private drawCheck(d: DrawCtx, slot: SlotGeometry, item: CheckItem, fields: ProjectFields) {
    if (!isChecked(item, fields)) return;
    d.placements.push({ slot: item.slot, page: d.pageIndex, kind: 'check' });
    const [x0, y0, x1, y1] = slot.rect;
    const cx = (x0 + x1) / 2;
    const cy = d.pageHeight - (y0 + y1) / 2;
    const s = item.size ?? Math.min(x1 - x0, y1 - y0) * 0.8;
    const style = item.style ?? 'tick';
    if (style === 'dot') {
      const r = s / 2;
      const k = 0.5523 * r;
      d.page.pushOperators(
        pushGraphicsState(),
        setFillingRgbColor(0, 0, 0),
        moveTo(cx + r, cy),
        appendBezierCurve(cx + r, cy + k, cx + k, cy + r, cx, cy + r),
        appendBezierCurve(cx - k, cy + r, cx - r, cy + k, cx - r, cy),
        appendBezierCurve(cx - r, cy - k, cx - k, cy - r, cx, cy - r),
        appendBezierCurve(cx + k, cy - r, cx + r, cy - k, cx + r, cy),
        closePath(),
        fill(),
        popGraphicsState(),
      );
      return;
    }
    const ops = [
      pushGraphicsState(),
      setStrokingRgbColor(0, 0, 0),
      setLineWidth(Math.max(0.8, s * 0.13)),
      setLineCap(LineCapStyle.Round),
      setLineJoin(LineJoinStyle.Round),
    ];
    if (style === 'tick') {
      ops.push(moveTo(cx - 0.42 * s, cy + 0.02 * s), lineTo(cx - 0.12 * s, cy - 0.32 * s), lineTo(cx + 0.45 * s, cy + 0.42 * s), stroke());
    } else {
      ops.push(moveTo(cx - 0.35 * s, cy - 0.35 * s), lineTo(cx + 0.35 * s, cy + 0.35 * s), moveTo(cx - 0.35 * s, cy + 0.35 * s), lineTo(cx + 0.35 * s, cy - 0.35 * s), stroke());
    }
    ops.push(popGraphicsState());
    d.page.pushOperators(...ops);
  }

  /** Editable Word document (Word-based templates only). */
  async generateDocx(templateKey: string, fields: ProjectFields, meta: GenerateOptions = {}): Promise<GeneratedDocument> {
    const entry = this.entry(templateKey);
    if (!entry.layout.docx || !this.assets.loadDocxTemplate) throw new Error('Word output is not available for this template');
    const template = await this.assets.loadDocxTemplate(entry.definition.key, entry.definition.version);
    const res = await buildDocx({
      template,
      entry,
      fields,
      ctx: { fields, registry: this.registry, company: this.company },
      options: meta,
      loadImage: this.assets.loadImage?.bind(this.assets),
      loadStamp: this.assets.loadStamp ? () => this.stampBytes() : undefined,
    });
    return {
      format: 'docx',
      templateKey,
      templateVersion: entry.definition.version,
      bytes: res.bytes,
      pageCount: entry.layout.pageCount,
      warnings: res.warnings,
      placements: res.filledSlots.map((slot) => ({
        slot,
        page: entry.layout.slots[slot]?.page ?? 0,
        kind: entry.definition.fields.some((f) => f.slot === slot && 'stamp' in f) ? ('stamp' as const) : ('text' as const),
      })),
    };
  }

  supportsDocx(templateKey: string): boolean {
    return Boolean(this.entry(templateKey).layout.docx);
  }

  stampBytes(): Promise<Uint8Array> {
    if (!this.assets.loadStamp) return Promise.reject(new Error('Company stamp not available'));
    this.stampCache ??= this.assets.loadStamp().catch((err) => {
      this.stampCache = undefined;
      throw err;
    });
    return this.stampCache;
  }

  /** Forget the cached stamp image (call after it is replaced). */
  clearStampCache() {
    this.stampCache = undefined;
  }

  private async drawStamp(d: DrawCtx, slot: SlotGeometry, item: StampItem) {
    try {
      const img = await d.doc.embedPng(await this.stampBytes());
      const { cx, cy, size } = stampBox(slot, item);
      const h = size * (img.height / img.width);
      d.page.drawImage(img, { x: cx - size / 2, y: d.pageHeight - cy - h / 2, width: size, height: h, opacity: 0.92 });
      d.placements.push({ slot: item.slot, page: d.pageIndex, kind: 'stamp' });
    } catch (err) {
      d.warnings.push({ code: 'image_error', slot: item.slot, message: `Stamp and signature could not be added (${(err as Error).message}).` });
    }
  }

  private async drawPhoto(d: DrawCtx, slot: SlotGeometry, item: PhotoItem, fields: ProjectFields) {
    const list = (fields[item.photo.field] as PhotoEntry[] | undefined) ?? [];
    const entry = list[item.photo.index];
    if (!entry?.path) return;
    if (!this.assets.loadImage) {
      d.warnings.push({ code: 'image_error', slot: item.slot, message: 'Photos cannot be loaded in this environment.' });
      return;
    }
    try {
      const bytes = await this.assets.loadImage(entry.path);
      const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
      const img = isPng ? await d.doc.embedPng(bytes) : await d.doc.embedJpg(bytes);
      const pad = item.padding ?? 4;
      const [x0, y0, x1, y1] = slot.rect;
      const bw = x1 - x0 - 2 * pad;
      const bh = y1 - y0 - 2 * pad;
      const scale = Math.min(bw / img.width, bh / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      const x = x0 + pad + (bw - w) / 2;
      const yTop = y0 + pad + (bh - h) / 2;
      d.page.drawImage(img, { x, y: d.pageHeight - yTop - h, width: w, height: h });
      d.placements.push({ slot: item.slot, page: d.pageIndex, kind: 'photo' });
    } catch (err) {
      d.warnings.push({ code: 'image_error', slot: item.slot, message: `Photo ${item.photo.index + 1} could not be embedded (${(err as Error).message}).` });
    }
  }
}

function resolveAlign(align: TextStyle['align'], dir: Dir): 'left' | 'right' | 'center' {
  if (align === 'left' || align === 'right' || align === 'center') return align;
  if (align === 'end') return dir === 'rtl' ? 'left' : 'right';
  return dir === 'rtl' ? 'right' : 'left';
}

function round(n: number) {
  return Math.round(n * 1000) / 1000;
}
