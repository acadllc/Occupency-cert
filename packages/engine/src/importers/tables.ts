/**
 * Reads tables of people (owners, heirs, partners…) such as
 *   م | الاسم | الجنسية | رقم الإثبات
 * from powers of attorney, كفالة papers and similar documents.
 */
import { isArabic, joinArabic, joinLatin, lines, squash, titleCase, type TextItem } from './common';
import type { Person } from './documents';

type Col = 'name' | 'nationality' | 'id';

const HEADERS: Record<Col, string[]> = {
  name: ['الاسم', 'الإسم', 'اسم', 'اسم المالك', 'الاسم الكامل', 'name', 'full name', 'owner name'],
  nationality: ['الجنسية', 'nationality'],
  id: ['رقم الاثبات', 'رقم الإثبات', 'الاثبات', 'الإثبات', 'رقم الهوية', 'الهوية', 'رقم الجواز', 'id no', 'id number', 'emirates id', 'passport no', 'passport number'],
};

const EID_DIGITS = /784\d{12}/;

function formatId(s: string) {
  const d = s.replace(/[\s-]/g, '');
  const m = d.match(EID_DIGITS)?.[0];
  if (m) return `${m.slice(0, 3)}-${m.slice(3, 7)}-${m.slice(7, 14)}-${m.slice(14)}`;
  return s.trim();
}

function headerColumns(line: TextItem[]): { col: Col; center: number }[] | null {
  const found = new Map<Col, number>();
  const sorted = line.slice().sort((a, b) => b.x - a.x);
  for (let i = 0; i < sorted.length; i++) {
    // try one or two adjacent items ("رقم" + "الاثبات")
    for (const k of [2, 1]) {
      const group = sorted.slice(i, i + k);
      if (group.length < k) continue;
      const text = squash(group.map((g) => g.str).join(''));
      const text2 = squash(group.slice().reverse().map((g) => g.str).join(''));
      for (const col of Object.keys(HEADERS) as Col[]) {
        if (found.has(col)) continue;
        if (HEADERS[col].some((h) => squash(h) === text || squash(h) === text2)) {
          const x0 = Math.min(...group.map((g) => g.x));
          const x1 = Math.max(...group.map((g) => g.x + g.w));
          found.set(col, (x0 + x1) / 2);
        }
      }
    }
  }
  if (!found.has('name') || found.size < 2) return null;
  return [...found.entries()].map(([col, center]) => ({ col, center }));
}

export type TableColumns = { col: Col; center: number }[];

/**
 * People listed in a table under a recognised header row. On a continuation
 * page without a header, pass the previous page's columns: rows are then read
 * from the top of the page.
 */
export function readPeopleTable(items: TextItem[], prev?: TableColumns): { people: Person[]; cols: TableColumns | null } {
  const rows = lines(items);
  const starts: { h: number; cols: TableColumns }[] = [];
  for (let h = 0; h < rows.length; h++) {
    const cols = headerColumns(rows[h]);
    if (cols) starts.push({ h, cols });
  }
  if (!starts.length && prev) starts.push({ h: -1, cols: prev });
  for (const { h, cols } of starts) {
    const sorted = cols.slice().sort((a, b) => a.center - b.center);
    const colOf = (it: TextItem) => {
      const c = it.x + it.w / 2;
      let best = sorted[0];
      for (const s of sorted) if (Math.abs(s.center - c) < Math.abs(best.center - c)) best = s;
      // ignore items far outside every column (row numbers, margins)
      return Math.abs(best.center - c) < 140 ? best.col : null;
    };
    // column boundaries half-way between neighbouring header centres
    const bounds = sorted.slice(1).map((c, i) => (sorted[i].center + c.center) / 2);
    const crossesColumns = (it: TextItem) => bounds.some((b) => it.x < b - 4 && it.x + it.w > b + 4);
    const hasId = sorted.some((c) => c.col === 'id');
    const people: Person[] = [];
    let lastY = h >= 0 ? rows[h][0].y : (rows[0]?.[0].y ?? 0) - 1;
    for (let r = h + 1; r < rows.length; r++) {
      const line = rows[r];
      if (line[0].y - lastY > 40) break; // the table ended
      // running text below the table spans several columns
      if (line.some(crossesColumns)) {
        // a continuation page must start with rows (after a short page header)
        if (people.length || (h < 0 && line[0].y > 140)) break;
        continue;
      }
      const cells: Record<Col, TextItem[]> = { name: [], nationality: [], id: [] };
      for (const it of line) {
        const c = colOf(it);
        if (c) cells[c].push(it);
      }
      const name = cells.name;
      if (!name.length) {
        // a continuation page must start with rows (after a short page header)
        if (people.length || (h < 0 && line[0].y > 140)) break;
        continue;
      }
      const ar = name.filter((i) => isArabic(i.str));
      const en = name.filter((i) => !isArabic(i.str) && /[A-Za-z]/.test(i.str));
      const nat = cells.nationality;
      const natAr = joinArabic(nat.filter((i) => isArabic(i.str)));
      const natEn = joinLatin(nat.filter((i) => !isArabic(i.str) && /[A-Za-z]/.test(i.str)));
      const id = joinLatin(cells.id.filter((i) => /\d/.test(i.str)));
      // a row of a people table has a name and an ID (or, without an ID column, a nationality)
      const idOk = /\d{6,}|[A-Z]\d{5,}/.test(id.replace(/[\s-]/g, ''));
      if (hasId ? !idOk : !natAr && !natEn) {
        // a continuation page must start with rows (after a short page header)
        if (people.length || (h < 0 && line[0].y > 140)) break;
        continue;
      }
      people.push({
        ar: joinArabic(ar),
        en: titleCase(joinLatin(en)),
        id: id ? formatId(id) : undefined,
        nationalityAr: natAr || undefined,
        nationalityEn: natEn ? titleCase(natEn) : undefined,
      });
      lastY = line[0].y;
    }
    if (people.length) return { people, cols };
  }
  return { people: [], cols: null };
}
