/** Helpers shared by the document importers (positioned PDF text from pdf.js). */

export interface TextItem {
  str: string;
  /** left x, top y (top-left origin), width — in PDF points */
  x: number;
  y: number;
  w: number;
}

export interface ExtractedValue {
  field: string;
  value: string;
  source: string;
}

export const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
export const ROW_TOLERANCE = 4.5;
export const isArabic = (s: string) => ARABIC.test(s);

export function clean(s: string) {
  return fixLigatures(
    s
      .normalize('NFKC')
      .replace(/[‎‏‪-‮ـ]/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

/**
 * Some PDF writers map the lam-alef ligature back to the letters in the wrong
 * order ("االمارات" for "الامارات", "باإلقرار" for "بالإقرار", "عبدهللا" for "عبدالله").
 */
export function fixLigatures(s: string) {
  return s.replace(/ا([اأإآ])ل/g, 'ال$1').replace(/هللا/g, 'الله');
}

/** Split mixed items ("HAI AL HUMAIRAحي الحميرة") into single-script pieces. */
export function splitScripts(items: TextItem[]): TextItem[] {
  const out: TextItem[] = [];
  for (const it of items) {
    const s = clean(it.str);
    if (!s) continue;
    const pieces = s.match(/[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿][^A-Za-z]*|[^؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]+/g) ?? [s];
    if (pieces.length === 1) {
      out.push({ ...it, str: s });
      continue;
    }
    // approximate positions proportionally to length
    let offset = 0;
    for (const p of pieces) {
      const w = (it.w * p.length) / s.length;
      if (p.trim()) out.push({ str: p.trim(), x: it.x + offset, y: it.y, w });
      offset += w;
    }
  }
  return out;
}

export function titleCase(s: string) {
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/(^|[\s\-/(])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase());
}

// pieces of one word touch; words are separated by at least a narrow space
const WORD_GAP = 0.8;

function joinOrdered(sorted: TextItem[], gapOf: (prev: TextItem, cur: TextItem) => number) {
  let out = '';
  sorted.forEach((it, k) => {
    out += k === 0 || gapOf(sorted[k - 1], it) > WORD_GAP ? (k ? ' ' : '') + it.str : it.str;
  });
  return fixLigatures(out.replace(/\s+/g, ' ').trim());
}

/** Arabic words read right-to-left. */
export function joinArabic(items: TextItem[]) {
  return joinOrdered(
    items.slice().sort((a, b) => b.x - a.x),
    (prev, cur) => prev.x - (cur.x + cur.w),
  );
}

export function joinLatin(items: TextItem[]) {
  return joinOrdered(
    items.slice().sort((a, b) => a.x - b.x),
    (prev, cur) => cur.x - (prev.x + prev.w),
  );
}

/** Comparable form: no spaces, unified alef forms, lower case, no punctuation. */
export const squash = (s: string) =>
  s
    .replace(/\s+/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[:：.\-_/]/g, '')
    .toLowerCase();

/** Group items into visual lines (top to bottom). */
export function lines(items: TextItem[]): TextItem[][] {
  const sorted = items.slice().sort((a, b) => a.y - b.y);
  const groups: TextItem[][] = [];
  for (const it of sorted) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(g[0].y - it.y) <= ROW_TOLERANCE) g.push(it);
    else groups.push([it]);
  }
  return groups;
}

/** Plain text of a line in logical order (Latin left-to-right, Arabic right-to-left runs). */
export function lineText(line: TextItem[]) {
  return joinLatin(line);
}

export const ownersJoin = { ar: ' و ', en: ' & ' };

/** Join names, dropping duplicates (case/spacing-insensitive). */
export function uniqueJoin(names: string[], sep: string) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names.map((x) => x.trim()).filter(Boolean)) {
    const k = squash(n);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(n);
  }
  return out.join(sep);
}
