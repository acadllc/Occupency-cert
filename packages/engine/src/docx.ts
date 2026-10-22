/**
 * Editable Word (.docx) output for Word-based templates.
 *
 * The build step stores the sanitized DOCX with invisible markers (QZnZQ) at
 * every slot. Here each marker run is replaced by the value (keeping the run's
 * fonts/sizes, removing the white colour), photos become inline pictures, the
 * company stamp becomes a page-anchored picture, and check boxes are ticked.
 */
import JSZip from 'jszip';
import { isChecked, resolveValue, type ValueContext } from './values';
import { stampBox } from './stamp';
import type { CatalogEntry, GenerateOptions, PhotoEntry, ProjectFields, SlotGeometry } from './types';

const EMU_PER_PT = 12700;
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const NS_WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL_IMAGE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';

type SlotValue = { kind: 'text'; text: string } | { kind: 'photo'; bytes: Uint8Array; slot: SlotGeometry } | { kind: 'stamp'; bytes: Uint8Array; slot: SlotGeometry; size: number; cx: number; cy: number };

export interface DocxDeps {
  template: Uint8Array;
  entry: CatalogEntry;
  fields: ProjectFields;
  ctx: ValueContext;
  options: GenerateOptions;
  loadImage?: (path: string) => Promise<Uint8Array>;
  loadStamp?: () => Promise<Uint8Array>;
}

export interface DocxResult {
  bytes: Uint8Array;
  warnings: { code: 'image_error'; slot: string; message: string }[];
  filledSlots: string[];
}

export function escapeXml(s: string) {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
}

/** Pixel size of a PNG or JPEG. */
export function imageSize(b: Uint8Array): { width: number; height: number; ext: 'png' | 'jpeg' } {
  if (b[0] === 0x89 && b[1] === 0x50) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { width: dv.getUint32(16), height: dv.getUint32(20), ext: 'png' };
  }
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = b[i + 1];
    const len = (b[i + 2] << 8) | b[i + 3];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8], ext: 'jpeg' };
    }
    i += 2 + len;
  }
  throw new Error('Unsupported image format');
}

function picture(rid: string, id: number, name: string, cx: number, cy: number) {
  return (
    `<a:graphic xmlns:a="${NS_A}"><a:graphicData uri="${NS_PIC}"><pic:pic xmlns:pic="${NS_PIC}">` +
    `<pic:nvPicPr><pic:cNvPr id="${id}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic>`
  );
}

function inlineDrawing(rid: string, id: number, name: string, cx: number, cy: number) {
  return (
    `<w:r><w:drawing><wp:inline xmlns:wp="${NS_WP}" xmlns:r="${NS_R}" distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${id}" name="${name}"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="${NS_A}" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    picture(rid, id, name, cx, cy) +
    `</wp:inline></w:drawing></w:r>`
  );
}

function anchoredDrawing(rid: string, id: number, name: string, x: number, y: number, cx: number, cy: number) {
  return (
    `<w:r><w:drawing><wp:anchor xmlns:wp="${NS_WP}" xmlns:r="${NS_R}" distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="251660000" behindDoc="0" locked="0" layoutInCell="0" allowOverlap="1">` +
    `<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>${x}</wp:posOffset></wp:positionH>` +
    `<wp:positionV relativeFrom="page"><wp:posOffset>${y}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="${id}" name="${name}"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="${NS_A}" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    picture(rid, id, name, cx, cy) +
    `</wp:anchor></w:drawing></w:r>`
  );
}

/**
 * Shrinks the font of a run so a value fits a fixed width (a text box in Word
 * cannot shrink its text itself). The width is estimated from average glyph widths.
 */
export function fitRunSize(rPr: string, text: string, maxWidth: number, fallbackSize = 11): string {
  const half = Number(/<w:sz w:val="(\d+)"/.exec(rPr)?.[1] ?? Math.round(fallbackSize * 2));
  const size = half / 2;
  let em = 0;
  for (const ch of text) em += ch === ' ' ? 0.28 : /[A-Z0-9]/.test(ch) ? 0.64 : /[\u0600-\u06ff]/.test(ch) ? 0.45 : 0.52;
  const width = em * size;
  if (width <= maxWidth) return rPr;
  const fitted = Math.max(16, Math.floor((half * maxWidth) / width));
  const sz = `<w:sz w:val="${fitted}"/><w:szCs w:val="${fitted}"/>`;
  if (!rPr) return `<w:rPr>${sz}</w:rPr>`;
  // keep the schema order of w:rPr: sizes go where they were, or before the elements that follow them
  const stripped = rPr.replace(/<w:szCs w:val="\d+"\/>/g, '');
  if (/<w:sz w:val="\d+"\/>/.test(stripped)) return stripped.replace(/<w:sz w:val="\d+"\/>/, sz);
  const after = /<w:(?:highlight|u|effect|bdr|shd|fitText|vertAlign|rtl|cs|em|lang|eastAsianLayout|specVanish|oMath)[ />]/.exec(stripped);
  return after ? stripped.slice(0, after.index) + sz + stripped.slice(after.index) : stripped.replace('</w:rPr>', `${sz}</w:rPr>`);
}

/** Index of the first paragraph directly in w:body (not inside a table), or -1. */
export function firstBodyParagraph(xml: string): number {
  const body = xml.indexOf('<w:body>');
  if (body < 0) return -1;
  const tag = /<(\/?)w:(tbl|p)(?=[\s>\/])[^>]*?(\/?)>/g;
  tag.lastIndex = body;
  let depth = 0;
  for (let m = tag.exec(xml); m; m = tag.exec(xml)) {
    const [, close, name, selfClosing] = m;
    if (name === 'tbl') depth += close ? -1 : 1;
    else if (!close && !selfClosing && depth === 0) return m.index;
  }
  return -1;
}

// a run that contains only a marker (created by the template build)
const MARKER_RUN = /<w:r>((?:(?!<w:r[ >]|<\/w:r>).)*?)<w:t[^>]*>(QZ\d+ZQ)<\/w:t><\/w:r>/gs;
const PARAGRAPH = /<w:p[ >](?:(?!<\/w:p>).)*?<\/w:p>/gs;

export async function buildDocx(d: DocxDeps): Promise<DocxResult> {
  const { entry, fields, ctx, options } = d;
  const markers = entry.layout.docx?.markers;
  if (!markers) throw new Error('Word output is not available for this template');
  const zip = await JSZip.loadAsync(d.template);
  const warnings: DocxResult['warnings'] = [];
  const values = new Map<string, SlotValue>();

  for (const item of entry.definition.fields) {
    const slot = entry.layout.slots[item.slot];
    if ('stamp' in item) {
      if (!options.stamp || !d.loadStamp) continue;
      try {
        const box = stampBox(slot, item);
        values.set(item.slot, { kind: 'stamp', bytes: await d.loadStamp(), slot, size: box.size, cx: box.cx, cy: box.cy });
      } catch (e) {
        warnings.push({ code: 'image_error', slot: item.slot, message: `Stamp and signature could not be added (${(e as Error).message}).` });
      }
    } else if ('photo' in item) {
      const p = ((fields[item.photo.field] as PhotoEntry[] | undefined) ?? [])[item.photo.index];
      if (!p?.path) continue;
      try {
        if (!d.loadImage) throw new Error('photos unavailable');
        values.set(item.slot, { kind: 'photo', bytes: await d.loadImage(p.path), slot });
      } catch (e) {
        warnings.push({ code: 'image_error', slot: item.slot, message: `Photo ${item.photo.index + 1} could not be embedded (${(e as Error).message}).` });
      }
    } else if ('photoText' in item) {
      const p = ((fields[item.photoText.field] as PhotoEntry[] | undefined) ?? [])[item.photoText.index];
      const t = p?.[item.photoText.prop]?.trim();
      if (t) values.set(item.slot, { kind: 'text', text: t });
    } else if ('value' in item) {
      const t = resolveValue(item.value, ctx);
      if (t) values.set(item.slot, { kind: 'text', text: t });
    }
  }

  // media plumbing
  const relsPath = 'word/_rels/document.xml.rels';
  let rels = (await zip.file(relsPath)?.async('string')) ?? '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  let types = (await zip.file('[Content_Types].xml')!.async('string'))!;
  let mediaCounter = 0;
  const addImage = (bytes: Uint8Array) => {
    const { ext } = imageSize(bytes);
    mediaCounter++;
    const rid = `rIdAcad${mediaCounter}`;
    const target = `media/acad-${mediaCounter}.${ext === 'png' ? 'png' : 'jpeg'}`;
    zip.file(`word/${target}`, bytes);
    rels = rels.replace('</Relationships>', `<Relationship Id="${rid}" Type="${REL_IMAGE}" Target="${target}"/></Relationships>`);
    const e = ext === 'png' ? 'png' : 'jpeg';
    if (!new RegExp(`Extension="${e}"`, 'i').test(types)) {
      types = types.replace('</Types>', `<Default Extension="${e}" ContentType="image/${e}"/></Types>`);
    }
    return rid;
  };

  const maxWidths = new Map<string, number>();
  const fieldSizes = new Map<string, number>();
  for (const item of entry.definition.fields) {
    if ('docxMaxWidth' in item && item.docxMaxWidth) maxWidths.set(item.slot, item.docxMaxWidth);
    if ('value' in item && item.size) fieldSizes.set(item.slot, item.size);
  }

  const filled: string[] = [];
  const stampRuns: string[] = [];
  let drawingId = 9000;
  // stamps are positioned on the page (they need no marker in the text)
  const endRuns: string[] = [];
  const everyPage: { bytes: Uint8Array; x: number; y: number; cx: number; cy: number }[] = [];
  for (const [slotName, v] of values) {
    if (v.kind !== 'stamp') continue;
    const pageMode = entry.definition.fields.find((f) => f.slot === slotName && 'stamp' in f);
    const mode = pageMode && 'stamp' in pageMode ? pageMode.stamp.page : undefined;
    const size = imageSize(v.bytes);
    const h = v.size * (size.height / size.width);
    if (mode === 'every') {
      // the footer repeats on every page: anchor the stamp there (relative to the page)
      everyPage.push({ bytes: v.bytes, x: Math.round((v.cx - v.size / 2) * EMU_PER_PT), y: Math.round((v.cy - h / 2) * EMU_PER_PT), cx: Math.round(v.size * EMU_PER_PT), cy: Math.round(h * EMU_PER_PT) });
      filled.push(slotName);
      continue;
    }
    (mode === 'last' ? endRuns : stampRuns).push(
      anchoredDrawing(
        addImage(v.bytes),
        ++drawingId,
        'Company stamp and signature',
        Math.round((v.cx - v.size / 2) * EMU_PER_PT),
        Math.round((v.cy - h / 2) * EMU_PER_PT),
        Math.round(v.size * EMU_PER_PT),
        Math.round(h * EMU_PER_PT),
      ),
    );
    filled.push(slotName);
  }
  const parts = Object.keys(zip.files).filter((n) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(n));
  for (const name of parts) {
    let xml = await zip.file(name)!.async('string');
    if (!xml.includes('QZ') && !(name === 'word/document.xml' && (stampRuns.length || endRuns.length))) continue;
    // paragraphs holding a photo: fixed line height would clip the picture
    xml = xml.replace(PARAGRAPH, (p) => {
      const m = /QZ\d+ZQ/.exec(p);
      if (!m || values.get(markers[m[0]])?.kind !== 'photo') return p;
      return p.replace(/w:lineRule="exact"/g, 'w:lineRule="auto"').replace(/w:line="\d+"/g, 'w:line="240"');
    });
    // a value inside running text: the zero-width marker run is followed by the blank gap that
    // reserved its space; write the value with the gap's (normal) formatting instead
    xml = xml.replace(
      /<w:r>(?:(?!<w:r[ >]|<\/w:r>).)*?<w:t[^>]*>(QZ\d+ZQ)<\/w:t><\/w:r>\s*<w:r(?:\s[^>]*)?>((?:(?!<w:r[ >]|<\/w:r>).)*?)<w:t[^>]*>\u2002+<\/w:t><\/w:r>/gs,
      (_all, marker: string, gapInner: string) => `<w:r>${gapInner}<w:t>${marker}</w:t></w:r>`,
    );
    xml = xml.replace(MARKER_RUN, (_all, inner: string, marker: string) => {
      const slotName = markers[marker];
      const v = slotName ? values.get(slotName) : undefined;
      if (!v || v.kind === 'stamp') return ''; // stamps are added as page-anchored pictures
      filled.push(slotName);
      if (v.kind === 'text') {
        let rPr = (/<w:rPr>.*?<\/w:rPr>/s.exec(inner)?.[0] ?? '').replace(/<w:color [^>]*\/>/g, '');
        if (/<w:sz w:val="2"\/>/.test(rPr)) {
          // a zero-width marker (it could not change the template's layout): write the value at the field's size
          const half = Math.round((fieldSizes.get(slotName) ?? 11) * 2);
          rPr = rPr.replace(/<w:spacing w:val="-20"\/>/g, '').replace(/<w:sz(Cs)? w:val="2"\/>/g, (_m, cs: string | undefined) => `<w:sz${cs ?? ''} w:val="${half}"/>`);
        }
        const maxWidth = maxWidths.get(slotName);
        if (maxWidth) rPr = fitRunSize(rPr, v.text, maxWidth, entry.layout.slots[slotName]?.size);
        const body = v.text
          .split(/\r?\n/)
          // U+2011 (plot numbers) becomes Word's own non-breaking hyphen
          .map((line) => `<w:t xml:space="preserve">${escapeXml(line).replace(/\u2011/g, '</w:t><w:noBreakHyphen/><w:t xml:space="preserve">')}</w:t>`)
          .join('<w:br/>');
        return `<w:r>${rPr}${body}</w:r>`;
      }
      const size = imageSize(v.bytes);
      const rid = addImage(v.bytes);
      drawingId++;
      const [x0, y0, x1, y1] = v.slot.rect;
      const pad = 6;
      const scale = Math.min((x1 - x0 - 2 * pad) / size.width, (y1 - y0 - 2 * pad - 4) / size.height);
      const cx = Math.round(size.width * scale * EMU_PER_PT);
      const cy = Math.round(size.height * scale * EMU_PER_PT);
      return inlineDrawing(rid, drawingId, `Photo ${drawingId}`, cx, cy);
    });
    if (name === 'word/document.xml' && stampRuns.length) {
      // the stamp is positioned relative to the page; anchor it to the first body paragraph
      // (documents may open with a table: skip it, a picture anchored in a cell is laid out in the cell)
      const at = firstBodyParagraph(xml);
      if (at >= 0) {
        const open = xml.indexOf('>', at) + 1;
        const pPr = /^\s*<w:pPr>.*?<\/w:pPr>/s.exec(xml.slice(open))?.[0] ?? '';
        xml = xml.slice(0, open + pPr.length) + stampRuns.join('') + xml.slice(open + pPr.length);
      }
    }
    if (name === 'word/document.xml' && endRuns.length) {
      // end-of-document stamp: anchor it to the last body paragraph, so it lands on the last page
      const sect = xml.lastIndexOf('<w:sectPr');
      const lastP = xml.lastIndexOf('<w:p>', sect) > xml.lastIndexOf('<w:p ', sect) ? xml.lastIndexOf('<w:p>', sect) : xml.lastIndexOf('<w:p ', sect);
      if (lastP >= 0) {
        const open = xml.indexOf('>', lastP) + 1;
        const pPrEnd = xml.startsWith('<w:pPr', open) ? xml.indexOf('</w:pPr>', open) + 8 : open;
        xml = xml.slice(0, pPrEnd) + endRuns.join('') + xml.slice(pPrEnd);
      }
    }
    // never leave a marker behind; drop the blank gaps reserved for values in running text
    xml = xml.replace(/QZ\d+ZQ/g, '');
    xml = xml.replace(/<w:r(?:\s[^>]*)?>(?:(?!<w:r[ >]|<\/w:r>).)*?<w:t[^>]*>\u2002+<\/w:t><\/w:r>/gs, '');
    if (name === 'word/document.xml') {
      // tick check boxes (document order of the "☐" glyphs)
      const ticks = new Set(
        entry.definition.fields.filter((i) => 'check' in i && i.docxGlyph !== undefined && isChecked(i, fields)).map((i) => ('check' in i ? i.docxGlyph! : -1)),
      );
      if (ticks.size) {
        let n = -1;
        xml = xml.replace(/<w:t([^>]*)>([^<]*)<\/w:t>/g, (_m, attrs: string, text: string) => {
          const out = text.replace(/☐/g, (g) => (ticks.has(++n) ? '☑' : g));
          return `<w:t${attrs}>${out}</w:t>`;
        });
      }
    }
    zip.file(name, xml);
  }
  if (everyPage.length) {
    const footers = Object.keys(zip.files).filter((n) => /^word\/footer\d*\.xml$/.test(n));
    if (!footers.length) warnings.push({ code: 'image_error', slot: 'stamp', message: 'Stamp and signature could not be added to every page (the document has no footer).' });
    for (const name of footers) {
      const frelsPath = name.replace('word/', 'word/_rels/') + '.rels';
      let frels = (await zip.file(frelsPath)?.async('string')) ?? '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
      const runs = everyPage.map((st) => {
        const { ext } = imageSize(st.bytes);
        mediaCounter++;
        const rid = `rIdAcad${mediaCounter}`;
        const target = `media/acad-${mediaCounter}.${ext === 'png' ? 'png' : 'jpeg'}`;
        zip.file(`word/${target}`, st.bytes);
        frels = frels.replace('</Relationships>', `<Relationship Id="${rid}" Type="${REL_IMAGE}" Target="${target}"/></Relationships>`);
        const e = ext === 'png' ? 'png' : 'jpeg';
        if (!new RegExp(`Extension="${e}"`, 'i').test(types)) types = types.replace('</Types>', `<Default Extension="${e}" ContentType="image/${e}"/></Types>`);
        return anchoredDrawing(rid, ++drawingId, 'Company stamp and signature', st.x, st.y, st.cx, st.cy);
      });
      let fxml = await zip.file(name)!.async('string');
      // first paragraph of the footer: after its properties
      fxml = fxml.replace(/(<w:p(?:\s[^>]*)?>(?:\s*<w:pPr>.*?<\/w:pPr>)?)/s, (m) => m + runs.join(''));
      zip.file(name, fxml);
      zip.file(frelsPath, frels);
    }
  }
  zip.file(relsPath, rels);
  zip.file('[Content_Types].xml', types);
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return { bytes, warnings, filledSlots: filled };
}
