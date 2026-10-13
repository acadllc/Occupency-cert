/**
 * Embeds shaped glyphs as a Type0/CIDFontType2 font (Identity-H, glyph id =
 * CID) with a retain-gids HarfBuzz subset and a ToUnicode CMap so generated
 * values remain extractable/searchable.
 */
import { PDFDocument, PDFName, PDFRef, PDFString, PDFPage } from 'pdf-lib';
import type { FontAsset } from '../text/shaper';

export type Subsetter = (fontBytes: Uint8Array, gids: number[]) => Uint8Array;

/** Instantiate the standalone harfbuzz-subset.wasm (no imports needed). */
export async function createSubsetter(wasmBytes: Uint8Array | ArrayBuffer): Promise<Subsetter> {
  const { instance } = (await WebAssembly.instantiate(wasmBytes, {})) as unknown as WebAssembly.WebAssemblyInstantiatedSource;
  const e = instance.exports as Record<string, any>;
  if (typeof e._initialize === 'function') e._initialize();
  return (fontBytes, gids) => {
    const len = fontBytes.length;
    const fp = e.malloc(len) as number;
    new Uint8Array((e.memory as WebAssembly.Memory).buffer).set(fontBytes, fp);
    const blob = e.hb_blob_create(fp, len, 2 /* writable */, 0, 0);
    const face = e.hb_face_create(blob, 0);
    e.hb_blob_destroy(blob);
    const input = e.hb_subset_input_create_or_fail();
    const glyphSet = e.hb_subset_input_glyph_set(input);
    for (const g of gids) e.hb_set_add(glyphSet, g);
    // HB_SUBSET_FLAGS_NO_HINTING | HB_SUBSET_FLAGS_RETAIN_GIDS
    e.hb_subset_input_set_flags(input, 0x1 | 0x2);
    const sub = e.hb_subset_or_fail(face, input);
    if (!sub) {
      e.hb_subset_input_destroy(input);
      e.hb_face_destroy(face);
      e.free(fp);
      throw new Error('font subsetting failed');
    }
    const resBlob = e.hb_face_reference_blob(sub);
    const n = e.hb_blob_get_length(resBlob) as number;
    const dp = e.hb_blob_get_data(resBlob, 0) as number;
    const out = new Uint8Array((e.memory as WebAssembly.Memory).buffer, dp, n).slice();
    e.hb_blob_destroy(resBlob);
    e.hb_face_destroy(sub);
    e.hb_subset_input_destroy(input);
    e.hb_face_destroy(face);
    e.free(fp);
    return out;
  };
}

function utf16Hex(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) out += s.charCodeAt(i).toString(16).padStart(4, '0');
  return out.toUpperCase();
}

class EmbeddedFont {
  readonly ref: PDFRef;
  readonly used = new Map<number, string>();
  constructor(
    readonly asset: FontAsset,
    readonly resourceName: string,
    doc: PDFDocument,
  ) {
    this.ref = doc.context.nextRef();
  }

  use(gid: number, text: string) {
    const prev = this.used.get(gid);
    if (prev === undefined || (!prev && text)) this.used.set(gid, text);
  }

  finalize(doc: PDFDocument, subset: Subsetter | null) {
    const a = this.asset;
    const scale = 1000 / a.upem;
    const gids = [0, ...this.used.keys()].sort((x, y) => x - y);
    let fontFile = a.bytes;
    if (subset) {
      try {
        fontFile = subset(a.bytes, gids);
      } catch {
        fontFile = a.bytes;
      }
    }
    const ctx = doc.context;
    const tag = this.resourceName.replace(/[^A-Z]/g, '').padEnd(6, 'A').slice(0, 6);
    const baseFont = `${tag}+${a.name.replace(/[^A-Za-z0-9-]/g, '')}`;
    const ff = ctx.flateStream(fontFile, { Length1: fontFile.length });
    const w: (number | number[])[] = [];
    for (const g of gids) w.push(g, [Math.round(a.font.glyphHAdvance(g) * scale)]);
    const descriptor = ctx.obj({
      Type: 'FontDescriptor',
      FontName: baseFont,
      Flags: 4,
      FontBBox: a.bbox.map((v) => Math.round(v * scale)),
      ItalicAngle: 0,
      Ascent: Math.round(a.ascender * scale),
      Descent: Math.round(a.descender * scale),
      CapHeight: Math.round(a.ascender * scale * 0.7),
      StemV: 80,
      FontFile2: ctx.register(ff),
    });
    const cidFont = ctx.obj({
      Type: 'Font',
      Subtype: 'CIDFontType2',
      BaseFont: baseFont,
      CIDSystemInfo: { Registry: PDFString.of('Adobe'), Ordering: PDFString.of('Identity'), Supplement: 0 },
      FontDescriptor: ctx.register(descriptor),
      W: w,
      CIDToGIDMap: 'Identity',
    });
    const entries = [...this.used.entries()].filter(([, t]) => t);
    let cmap =
      '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n' +
      '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n' +
      '/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n';
    for (let i = 0; i < entries.length; i += 100) {
      const chunk = entries.slice(i, i + 100);
      cmap += `${chunk.length} beginbfchar\n`;
      for (const [g, t] of chunk) cmap += `<${g.toString(16).padStart(4, '0').toUpperCase()}> <${utf16Hex(t)}>\n`;
      cmap += 'endbfchar\n';
    }
    cmap += 'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n';
    const toUnicode = ctx.register(ctx.flateStream(cmap));
    const type0 = ctx.obj({
      Type: 'Font',
      Subtype: 'Type0',
      BaseFont: baseFont,
      Encoding: 'Identity-H',
      DescendantFonts: [ctx.register(cidFont)],
      ToUnicode: toUnicode,
    });
    ctx.assign(this.ref, type0);
  }
}

/** Tracks fonts used per document and registers them in page resources. */
export class FontRegistry {
  private fonts = new Map<string, EmbeddedFont>();
  private counter = 0;
  constructor(private doc: PDFDocument) {}

  get(asset: FontAsset): EmbeddedFont {
    let f = this.fonts.get(asset.name);
    if (!f) {
      this.counter++;
      const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      const name = `ACAD${letters[this.counter % 26]}${letters[Math.floor(this.counter / 26) % 26]}`;
      f = new EmbeddedFont(asset, name, this.doc);
      this.fonts.set(asset.name, f);
    }
    return f;
  }

  attach(page: PDFPage, font: EmbeddedFont) {
    // normalizedEntries() materialises (possibly inherited) Resources/Font dictionaries
    const { Font } = page.node.normalizedEntries();
    Font.set(PDFName.of(font.resourceName), font.ref);
  }

  finalize(subset: Subsetter | null) {
    for (const f of this.fonts.values()) f.finalize(this.doc, subset);
  }
}
