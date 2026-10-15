/**
 * Generic "label → value" reader for forms (كفالة papers, letters, IDs…):
 * finds a known label on a line and takes the value next to it — to the left
 * of an Arabic label, to the right of an English one — or, failing that,
 * directly below it.
 */
import { isArabic, joinArabic, joinLatin, lines, squash, type TextItem } from './common';

export interface LabelRule {
  field: string;
  /** Arabic and/or English labels (any spelling variants) */
  ar?: string[];
  en?: string[];
  /** which script the value is written in */
  value: 'ar' | 'en' | 'any';
  /** optional value pattern (the first match is kept) */
  pattern?: RegExp;
}

interface Found {
  field: string;
  value: string;
  label: string;
}

const GAP = 48; // a wider horizontal gap between words ends the value
const FIRST_GAP = 260;

function matchLabel(line: TextItem[], label: string, rtl: boolean, used: Set<TextItem>): { items: TextItem[] } | null {
  const target = squash(label);
  const sorted = line.slice().sort((a, b) => (rtl ? b.x - a.x : a.x - b.x));
  for (let i = 0; i < sorted.length; i++) {
    if (used.has(sorted[i])) continue;
    // a label starts a phrase: "Name" inside "Contractor Name" is not the owner's name
    const prev = sorted[i - 1];
    if (prev && /[\p{L}]$/u.test(prev.str.trim()) && Math.abs(rtl ? prev.x - (sorted[i].x + sorted[i].w) : sorted[i].x - (prev.x + prev.w)) < 8) continue;
    let acc = '';
    for (let k = i; k < Math.min(sorted.length, i + 5); k++) {
      if (used.has(sorted[k])) break;
      acc += squash(sorted[k].str);
      if (acc === target) return { items: sorted.slice(i, k + 1) };
      // the item may hold the label followed by ":" and the value ("Name: SALEM")
      if (k === i && squash(sorted[k].str).startsWith(target) && sorted[k].str.includes(':')) return { items: [sorted[k]] };
      if (!target.startsWith(acc)) break;
    }
  }
  return null;
}

function takeRun(cands: TextItem[], fromEdge: number, rtl: boolean) {
  const run: TextItem[] = [];
  let edge = fromEdge;
  for (const it of cands) {
    const gap = rtl ? edge - (it.x + it.w) : it.x - edge;
    // the value may sit far from its label (dotted leaders); its words sit close together
    if (gap > (run.length ? GAP : FIRST_GAP)) break;
    run.push(it);
    edge = rtl ? it.x : it.x + it.w;
  }
  return run;
}

function valueFrom(items: TextItem[], rule: LabelRule, rtl: boolean): string {
  const want = (it: TextItem) => rule.value === 'any' || (rule.value === 'ar' ? isArabic(it.str) : !isArabic(it.str) && /[A-Za-z0-9]/.test(it.str));
  const list = items.filter((i) => want(i) && i.str.trim() && i.str.trim() !== ':');
  if (!list.length) return '';
  const text = rule.value === 'ar' || (rule.value === 'any' && rtl) ? joinArabic(list) : joinLatin(list);
  const cleaned = text.replace(/^[:\s]+|[:\s]+$/g, '').trim();
  if (rule.pattern) return cleaned.match(rule.pattern)?.[0] ?? '';
  return cleaned;
}

export function readLabels(items: TextItem[], rules: LabelRule[]): Found[] {
  const rows = lines(items);
  const allLabels = rules.flatMap((r) => [...(r.ar ?? []), ...(r.en ?? [])]).map(squash);
  const isLabel = (it: TextItem) => allLabels.includes(squash(it.str));
  const found: Found[] = [];
  // label words already claimed by an earlier (longer) rule, e.g. "رقم المشروع بالبلدية" before "رقم المشروع"
  const used = new Set<TextItem>();
  for (const rule of rules) {
    let hit: Found | null = null;
    for (const [labels, rtl] of [
      [rule.ar ?? [], true],
      [rule.en ?? [], false],
    ] as const) {
      for (const label of labels) {
        for (let li = 0; li < rows.length && !hit; li++) {
          const line = rows[li];
          const m = matchLabel(line, label, rtl, used);
          if (!m) continue;
          const minX = Math.min(...m.items.map((i) => i.x));
          const maxX = Math.max(...m.items.map((i) => i.x + i.w));
          // "Label: value" inside one item
          const single = m.items.length === 1 && m.items[0].str.includes(':') ? m.items[0].str.split(':').slice(1).join(':').trim() : '';
          let value = single ? valueFrom([{ ...m.items[0], str: single }], rule, rtl) : '';
          if (!value) {
            const rest = line.filter((i) => !m.items.includes(i) && !isLabel(i));
            const side = rtl ? rest.filter((i) => i.x + i.w <= minX + 2).sort((a, b) => b.x - a.x) : rest.filter((i) => i.x >= maxX - 2).sort((a, b) => a.x - b.x);
            value = valueFrom(takeRun(side, rtl ? minX : maxX, rtl), rule, rtl);
          }
          if (!value && li + 1 < rows.length && rows[li + 1][0].y - line[0].y < 18) {
            // value printed under the label
            const below = rows[li + 1].filter((i) => i.x + i.w > minX - 30 && i.x < maxX + 30 && !isLabel(i));
            value = valueFrom(below, rule, rtl);
          }
          m.items.forEach((i) => used.add(i));
          if (value) hit = { field: rule.field, value, label };
        }
        if (hit) break;
      }
      if (hit) break;
    }
    if (hit) found.push(hit);
  }
  return found;
}
