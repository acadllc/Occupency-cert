/**
 * Parser for Abu Dhabi Real Estate Centre "Land Site Plan / مخطط أرض" PDFs.
 *
 * Input is the positioned text of page 1 (from pdf.js in the browser), so the
 * parser is pure and testable. It reads the PROPERTY DETAILS rows by their
 * English labels and the OWNER DETAILS table, and splits each value into its
 * English and Arabic parts. Nothing is guessed: unknown rows are skipped.
 */
import type { ProjectFields } from './types';

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

export interface SitePlanResult {
  recognised: boolean;
  values: ExtractedValue[];
  fields: ProjectFields;
  notes: string[];
}

const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const ROW_TOLERANCE = 4.5;

function clean(s: string) {
  return s
    .normalize('NFKC')
    .replace(/[‎‏‪-‮ـ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Split mixed items ("HAI AL HUMAIRAحي الحميرة") into single-script pieces. */
function splitScripts(items: TextItem[]): TextItem[] {
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

const isArabic = (s: string) => ARABIC.test(s);

function titleCase(s: string) {
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/(^|[\s\-/(])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase());
}

function joinArabic(items: TextItem[]) {
  // Arabic words read right-to-left
  return items
    .slice()
    .sort((a, b) => b.x - a.x)
    .map((i) => i.str)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function joinLatin(items: TextItem[]) {
  return items
    .slice()
    .sort((a, b) => a.x - b.x)
    .map((i) => i.str)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
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

const squash = (s: string) => s.replace(/\s+/g, '').replace(/[أإآ]/g, 'ا').toLowerCase();

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

export function parseSitePlan(raw: TextItem[]): SitePlanResult {
  const items = splitScripts(raw);
  const all = items.map((i) => i.str).join(' ');
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

  // ---- owners table
  const header = items.find((i) => i.str === 'Name');
  const nationality = items.find((i) => i.str === 'Nationality');
  const hash = items.find((i) => i.str === '#' && header && Math.abs(i.y - header.y) < 12);
  if (header && nationality) {
    const left = nationality.x + nationality.w + 4;
    const right = hash ? hash.x - 3 : Number.POSITIVE_INFINITY;
    const footer = items.find((i) => /issued electronically|Application Date/i.test(i.str));
    const bottom = footer ? footer.y - 4 : header.y + 160;
    const numbers = items
      .filter((i) => hash && /^\d{1,2}$/.test(i.str) && Math.abs(i.x - hash.x) < 8 && i.y > header.y + 4 && i.y < bottom)
      .sort((a, b) => a.y - b.y);
    // each owner row: from just above its number to ~30pt below (names wrap onto two or three lines)
    const bands = numbers.length
      ? numbers.map((n, k) => [Math.max(header.y + 6, n.y - 14), Math.min(n.y + 30, k + 1 < numbers.length ? numbers[k + 1].y - 14 : bottom)])
      : [[header.y + 6, Math.min(bottom, header.y + 60)]];
    const ownersAr: string[] = [];
    const ownersEn: string[] = [];
    for (const [top, bot] of bands) {
      const cell = items.filter((i) => i.y > top && i.y <= bot && i.x >= left - 1 && i.x + i.w / 2 < right && i.str !== 'Name' && i.str !== 'الاسم');
      const ar = cell.filter((i) => isArabic(i.str));
      const en = cell.filter((i) => !isArabic(i.str) && /[A-Za-z]/.test(i.str));
      // group lines top-to-bottom, words within a line by direction
      const lines = (list: TextItem[], rtl: boolean) => {
        const sorted = list.slice().sort((a, b) => a.y - b.y);
        const groups: TextItem[][] = [];
        for (const it of sorted) {
          const g = groups[groups.length - 1];
          if (g && Math.abs(g[0].y - it.y) <= ROW_TOLERANCE) g.push(it);
          else groups.push([it]);
        }
        return groups.map((g) => (rtl ? joinArabic(g) : joinLatin(g))).join(' ');
      };
      const a = lines(ar, true);
      const e = lines(en, false);
      if (a) ownersAr.push(a);
      if (e) ownersEn.push(titleCase(e));
    }
    if (ownersAr.length) put('owner_name_ar', ownersAr.join(' و '), 'Owner name (Arabic)');
    if (ownersEn.length) put('owner_name_en', ownersEn.join(' & '), 'Owner name (English)');
    if (ownersAr.length > 1) notes.push(`${ownersAr.length} owners found; names were joined.`);
  }
  if (!recognised) notes.push('This does not look like an Abu Dhabi Real Estate Centre site plan; check the values carefully.');
  return { recognised, values, fields, notes };
}
