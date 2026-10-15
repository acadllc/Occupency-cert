/**
 * Parser for Abu Dhabi Real Estate Centre "Land Site Plan / مخطط أرض" PDFs.
 *
 * Input is the positioned text of each page (from pdf.js in the browser), so the
 * parser is pure and testable. It reads the PROPERTY DETAILS rows by their
 * English labels and the OWNER DETAILS table, and splits each value into its
 * English and Arabic parts. Nothing is guessed: unknown rows are skipped.
 */
import type { ProjectFields } from '../types';
import { ROW_TOLERANCE, isArabic, joinArabic, joinLatin, ownersJoin, splitScripts, squash, titleCase, type ExtractedValue, type TextItem } from './common';

export type { ExtractedValue, TextItem };

export interface SitePlanResult {
  recognised: boolean;
  values: ExtractedValue[];
  fields: ProjectFields;
  notes: string[];
  /** owners in table order (Arabic / English) */
  owners: { ar: string; en: string }[];
}

/** Rows: English label (left column) -> Arabic label (right column). */
const ROWS: Record<string, { en: string; ar: string }> = {
  municipality: { en: 'municipality', ar: 'البلدية' },
  zone: { en: 'zone', ar: 'المنطقة' },
  sector: { en: 'sector', ar: 'الحوض' },
  plotAddress: { en: 'plot address', ar: 'عنوان القسيمة' },
  landNo: { en: 'land no.', ar: 'رقم الارض' },
  allocationType: { en: 'allocation type', ar: 'مسمى التخصيص' },
  landUse: { en: 'land use', ar: 'استخدام الأرض' },
  plotArea: { en: 'plot area', ar: 'مساحة الأرض' },
  roadName: { en: 'road name', ar: 'اسم الشارع' },
};

function readRow(items: TextItem[], label: TextItem, arLabel: string) {
  const row = items.filter((i) => i !== label && Math.abs(i.y - label.y) <= ROW_TOLERANCE && i.x > label.x + label.w + 2);
  const arabic = row.filter((i) => isArabic(i.str));
  const latin = row.filter((i) => !isArabic(i.str));
  // drop the trailing Arabic label (rightmost run of Arabic words matching the expected label)
  const byX = arabic.slice().sort((a, b) => b.x - a.x);
  const target = squash(arLabel);
  let cut = 0;
  for (let k = 1; k <= byX.length; k++) {
    // reading order of RTL words = right to left
    if (squash(byX.slice(0, k).map((i) => i.str).join('')) === target) {
      cut = k;
      break;
    }
  }
  const values = byX.slice(cut);
  return { en: joinLatin(latin), ar: joinArabic(values), labelled: cut > 0 };
}

/** Parses a site plan. Pass one array per page (or a single page as a flat array). */
export function parseSitePlan(raw: TextItem[] | TextItem[][]): SitePlanResult {
  const pages: TextItem[][] = raw.length && Array.isArray(raw[0]) ? (raw as TextItem[][]) : [raw as TextItem[]];
  const items = splitScripts(pages[0] ?? []);
  const all = pages.flat().map((i) => i.str).join(' ');
  const recognised = /land site plan/i.test(all) || /مخطط\s*أرض/.test(all) || /PROPERTY DETAILS/i.test(all);
  const values: ExtractedValue[] = [];
  const notes: string[] = [];
  const fields: ProjectFields = {};
  const put = (field: string, value: string, source: string) => {
    const v = value.trim();
    if (!v) return;
    fields[field] = v;
    values.push({ field, value: v, source });
  };

  const rows: Record<string, { en: string; ar: string; labelled: boolean }> = {};
  for (const [key, def] of Object.entries(ROWS)) {
    // the same words also appear in the map legend; the table row is the one whose Arabic label sits on the same line
    const candidates = items.filter((i) => i.str.toLowerCase().replace(/\s+/g, ' ') === def.en);
    const read = candidates.map((label) => readRow(items, label, def.ar)).filter((r) => r.labelled);
    const best = read.find((r) => r.en || r.ar) ?? read[0];
    if (best) rows[key] = best;
  }

  const muni = rows.municipality;
  if (muni) {
    const text = `${muni.en} ${muni.ar}`;
    if (/al\s*ain|العين/i.test(text)) put('city', 'al_ain', 'Municipality');
    else if (/abu\s*dhabi|أبوظبي|ابوظبي|أبو ظبي/i.test(text)) put('city', 'abu_dhabi', 'Municipality');
    else notes.push(`Municipality "${text.trim()}" is not one of the supported cities.`);
  }
  if (rows.zone) {
    put('area_en', titleCase(rows.zone.en), 'Zone');
    put('area_ar', rows.zone.ar, 'المنطقة');
  }
  if (rows.sector) {
    put('sector_en', titleCase(rows.sector.en), 'Sector');
    put('sector_ar', rows.sector.ar, 'الحوض');
  }
  if (rows.plotAddress?.en) put('plot_number', rows.plotAddress.en.replace(/\s+/g, ''), 'Plot Address');
  else if (rows.landNo?.en) put('plot_number', rows.landNo.en, 'Land No.');
  if (rows.allocationType) {
    put('land_building_usage_en', titleCase(rows.allocationType.en), 'Allocation Type');
    put('land_building_usage_ar', rows.allocationType.ar, 'مسمى التخصيص');
  } else if (rows.landUse) {
    put('land_building_usage_en', titleCase(rows.landUse.en), 'Land Use');
    put('land_building_usage_ar', rows.landUse.ar, 'استخدام الأرض');
  }

  // ---- owners table (it continues on the next pages when there are many owners)
  const owners: { ar: string; en: string }[] = [];
  let cols: OwnerColumns | undefined;
  pages.forEach((page, i) => {
    const res = readOwners(i === 0 ? items : splitScripts(page), cols);
    if (res) {
      cols = res.cols;
      owners.push(...res.owners);
    }
  });
  if (owners.length) {
    put('owner_name_ar', owners.map((o) => o.ar).filter(Boolean).join(ownersJoin.ar), 'Owner name (Arabic)');
    put('owner_name_en', owners.map((o) => o.en).filter(Boolean).join(ownersJoin.en), 'Owner name (English)');
    if (owners.length > 1) notes.push(`${owners.length} owners found${pages.length > 1 ? ` on ${pages.length} pages` : ''}; their names are listed side by side (small font in the documents when needed).`);
  }
  if (!recognised) notes.push('This does not look like an Abu Dhabi Real Estate Centre site plan; check the values carefully.');
  return { recognised, values, fields, notes, owners };
}

interface OwnerColumns {
  left: number;
  right: number;
  hashX: number | null;
}

/** OWNER DETAILS table: one entry per numbered row; names wrap onto two or three lines. */
function readOwners(items: TextItem[], prev?: OwnerColumns): { owners: { ar: string; en: string }[]; cols: OwnerColumns } | null {
  const header = items.find((i) => i.str === 'Name');
  const nationality = items.find((i) => i.str === 'Nationality');
  let cols: OwnerColumns;
  let top: number;
  if (header && nationality) {
    const hash = items.find((i) => i.str === '#' && Math.abs(i.y - header.y) < 12);
    cols = { left: nationality.x + nationality.w + 4, right: hash ? hash.x - 3 : Number.POSITIVE_INFINITY, hashX: hash ? hash.x : null };
    top = header.y;
  } else if (prev) {
    // continuation page without a header: same columns, from the top of the page
    cols = prev;
    top = 0;
  } else {
    return null;
  }
  const footer = items.find((i) => i.y > top && /issued electronically|Application Date/i.test(i.str));
  const bottom = footer ? footer.y - 4 : top + (header ? 160 : 800);
  const numbers = items
    .filter((i) => cols.hashX !== null && /^\d{1,3}$/.test(i.str) && Math.abs(i.x - cols.hashX) < 8 && i.y > top + 4 && i.y < bottom)
    .sort((a, b) => a.y - b.y);
  const bands = numbers.length
    ? numbers.map((n, k) => [Math.max(top + 6, n.y - 14), Math.min(n.y + 30, k + 1 < numbers.length ? numbers[k + 1].y - 14 : bottom)])
    : header
      ? [[top + 6, Math.min(bottom, top + 60)]]
      : [];
  const owners: { ar: string; en: string }[] = [];
  for (const [t, b] of bands) {
    const cell = items.filter((i) => i.y > t && i.y <= b && i.x >= cols.left - 1 && i.x + i.w / 2 < cols.right && i.str !== 'Name' && i.str !== 'الاسم');
    const byLine = (list: TextItem[], rtl: boolean) => {
      const sorted = list.slice().sort((a, c) => a.y - c.y);
      const groups: TextItem[][] = [];
      for (const it of sorted) {
        const g = groups[groups.length - 1];
        if (g && Math.abs(g[0].y - it.y) <= ROW_TOLERANCE) g.push(it);
        else groups.push([it]);
      }
      return groups.map((g) => (rtl ? joinArabic(g) : joinLatin(g))).join(' ');
    };
    const ar = byLine(cell.filter((i) => isArabic(i.str)), true);
    const en = byLine(cell.filter((i) => !isArabic(i.str) && /[A-Za-z]/.test(i.str)), false);
    if (ar || en) owners.push({ ar, en: titleCase(en) });
  }
  return { owners, cols };
}
