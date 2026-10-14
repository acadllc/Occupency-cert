/**
 * Text shaping with HarfBuzz (Arabic joining, ligatures, marks) and the
 * Unicode Bidirectional Algorithm (bidi-js) for mixed Arabic/English/digits.
 *
 * pdf-lib's built-in font layout cannot shape Arabic, so we shape here and
 * write glyph ids directly (see pdf/fonts.ts).
 */
import * as hb from 'harfbuzzjs';
import bidiFactory from 'bidi-js';
import type { Dir, FontFamily } from '../types';

const bidi = bidiFactory();

export interface FontAsset {
  name: string;
  bytes: Uint8Array;
  font: hb.Font;
  upem: number;
  ascender: number;
  descender: number;
  bbox: [number, number, number, number];
  unicodes: Set<number>;
}

export function loadFontAsset(name: string, bytes: Uint8Array): FontAsset {
  const blob = new hb.Blob(bytes);
  const face = new hb.Face(blob, 0);
  const font = new hb.Font(face);
  const upem = face.upem;
  const ext = font.hExtents();
  const head = face.referenceTable('head');
  let bbox: [number, number, number, number] = [0, ext.descender, upem, ext.ascender];
  if (head && head.length >= 44) {
    const dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
    bbox = [dv.getInt16(36), dv.getInt16(38), dv.getInt16(40), dv.getInt16(42)];
  }
  return {
    name,
    bytes,
    font,
    upem,
    ascender: ext.ascender,
    descender: ext.descender,
    bbox,
    unicodes: new Set(face.collectUnicodes()),
  };
}

export interface FamilyFonts {
  arabic: FontAsset;
  latin: FontAsset;
}

export type FontBook = Record<string, FamilyFonts>; // key: `${family}` or `${family}-bold`

export interface ShapedGlyph {
  font: FontAsset;
  gid: number;
  /** pen position of the glyph origin, in em-units scaled to 1pt (multiply by size) */
  x: number;
  dx: number;
  dy: number;
  advance: number;
  text: string;
}

export interface ShapedLine {
  /** logical (reading-order) text, used for ActualText */
  text: string;
  glyphs: ShapedGlyph[];
  /** width at size 1 (multiply by font size) */
  width: number;
  missing: string[];
}

const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const LATIN = /[A-Za-zÀ-ɏ]/;
const STRONG_RTL = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
const STRONG_LTR = /[A-Za-zÀ-ɏ]/;

export function detectDir(text: string, fallback: Dir = 'ltr'): Dir {
  for (const ch of text) {
    if (STRONG_RTL.test(ch)) return 'rtl';
    if (STRONG_LTR.test(ch)) return 'ltr';
  }
  return fallback;
}

export function familyKey(family: FontFamily, bold?: boolean): string {
  return bold ? `${family}-bold` : family;
}

interface Run {
  start: number;
  end: number;
  level: number;
  font: FontAsset;
}

/** Arabic letters -> Arabic font, Latin letters -> Latin font, digits/punctuation follow the paragraph direction. */
function chooseFont(ch: string, baseRtl: boolean, fam: FamilyFonts): FontAsset {
  const cp = ch.codePointAt(0)!;
  let pref: FontAsset;
  if (ARABIC.test(ch)) pref = fam.arabic;
  else if (LATIN.test(ch)) pref = fam.latin;
  else pref = baseRtl ? fam.arabic : fam.latin;
  if (pref.unicodes.has(cp)) return pref;
  const other = pref === fam.arabic ? fam.latin : fam.arabic;
  return other.unicodes.has(cp) ? other : pref;
}

function shapeRun(text: string, rtl: boolean, font: FontAsset) {
  const buf = new hb.Buffer();
  buf.addText(text);
  buf.guessSegmentProperties();
  buf.setDirection(rtl ? hb.Direction.RTL : hb.Direction.LTR);
  hb.shape(font.font, buf);
  const infos = buf.getGlyphInfos();
  const pos = buf.getGlyphPositions();
  // cluster -> source text (clusters are UTF-16 offsets)
  const starts = [...new Set(infos.map((g) => g.cluster))].sort((a, b) => a - b);
  const textOf = new Map<number, string>();
  starts.forEach((s, i) => textOf.set(s, text.slice(s, i + 1 < starts.length ? starts[i + 1] : text.length)));
  const seen = new Set<number>();
  return infos.map((g, i) => {
    const first = !seen.has(g.cluster);
    seen.add(g.cluster);
    return {
      gid: g.codepoint,
      advance: pos[i].xAdvance / font.upem,
      dx: pos[i].xOffset / font.upem,
      dy: pos[i].yOffset / font.upem,
      text: first ? textOf.get(g.cluster) ?? '' : '',
    };
  });
}

/** Shape one visual line. `baseDir` is the paragraph direction. */
export function shapeLine(text: string, baseDir: Dir, fam: FamilyFonts): ShapedLine {
  const clean = text.replace(/[\r\n\t]+/g, ' ');
  if (!clean) return { text: '', glyphs: [], width: 0, missing: [] };
  const { levels } = bidi.getEmbeddingLevels(clean, baseDir);
  const chars = Array.from(clean);
  // map char index -> utf16 offset
  const runs: Run[] = [];
  let offset = 0;
  for (const ch of chars) {
    const lvl = levels[offset];
    const font = chooseFont(ch, baseDir === 'rtl', fam);
    const last = runs[runs.length - 1];
    if (last && last.level === lvl && last.font === font) last.end = offset + ch.length;
    else runs.push({ start: offset, end: offset + ch.length, level: lvl, font });
    offset += ch.length;
  }
  // Rule L2: reverse contiguous sequences at each level from the highest to the lowest odd level
  const maxLevel = Math.max(...runs.map((r) => r.level));
  const minOdd = Math.min(...runs.map((r) => r.level).filter((l) => l % 2 === 1), maxLevel + 1);
  let visual = runs.slice();
  for (let L = maxLevel; L >= minOdd; L--) {
    const out: Run[] = [];
    let i = 0;
    while (i < visual.length) {
      if (visual[i].level >= L) {
        let j = i;
        while (j < visual.length && visual[j].level >= L) j++;
        out.push(...visual.slice(i, j).reverse());
        i = j;
      } else out.push(visual[i++]);
    }
    visual = out;
  }
  const glyphs: ShapedGlyph[] = [];
  const missing: string[] = [];
  let x = 0;
  for (const r of visual) {
    const t = clean.slice(r.start, r.end);
    for (const g of shapeRun(t, r.level % 2 === 1, r.font)) {
      if (g.gid === 0 && g.text.trim()) missing.push(g.text);
      glyphs.push({ font: r.font, gid: g.gid, x, dx: g.dx, dy: g.dy, advance: g.advance, text: g.text });
      x += g.advance;
    }
  }
  return { text: clean, glyphs, width: x, missing };
}

/** Greedy word wrap; breaks at spaces, and inside over-long words as a last resort. */
export function wrapText(text: string, baseDir: Dir, fam: FamilyFonts, size: number, maxWidth: number): ShapedLine[] {
  const lines: ShapedLine[] = [];
  for (const para of text.split(/\r?\n/)) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push({ text: '', glyphs: [], width: 0, missing: [] });
      continue;
    }
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      const shaped = shapeLine(candidate, baseDir, fam);
      if (shaped.width * size <= maxWidth || !current) {
        current = candidate;
      } else {
        lines.push(shapeLine(current, baseDir, fam));
        current = word;
      }
    }
    if (current) lines.push(shapeLine(current, baseDir, fam));
  }
  return lines;
}
