/**
 * Reads project details from uploaded PDFs: the Land Site Plan, Emirates ID,
 * passports, كفالة papers and other forms with labelled fields. Pure functions
 * over positioned text (pdf.js), one array per page.
 */
import { parseSitePlan } from './siteplan';
import { lines, lineText, ownersJoin, splitScripts, titleCase, uniqueJoin, type ExtractedValue, type TextItem } from './common';
import { readLabels, type LabelRule } from './labels';
import { readPeopleTable, type TableColumns } from './tables';

export type DocumentKind = 'siteplan' | 'emirates_id' | 'passport' | 'document';

export interface Person {
  ar: string;
  en: string;
  id?: string;
  nationalityAr?: string;
  nationalityEn?: string;
}

export interface DocumentImport {
  kind: DocumentKind;
  label: string;
  values: ExtractedValue[];
  owners: Person[];
  notes: string[];
}

export const KIND_LABELS: Record<DocumentKind, string> = {
  siteplan: 'Site plan / مخطط أرض',
  emirates_id: 'Emirates ID / الهوية',
  passport: 'Passport / جواز السفر',
  document: 'Document / مستند',
};

const EID = /\b784[-\s]?\d{4}[-\s]?\d{7}[-\s]?\d\b/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE = /(?:\+971|00971|\b0)\s?-?(?:5\d|[234679])[\s-]?\d{3}[\s-]?\d{4}\b/;

/** ISO 3166 alpha-3 → country (English / Arabic) for the nationalities seen most often. */
const COUNTRIES: Record<string, [string, string]> = {
  ARE: ['United Arab Emirates', 'الإمارات العربية المتحدة'],
  SAU: ['Saudi Arabia', 'السعودية'],
  OMN: ['Oman', 'عمان'],
  KWT: ['Kuwait', 'الكويت'],
  QAT: ['Qatar', 'قطر'],
  BHR: ['Bahrain', 'البحرين'],
  YEM: ['Yemen', 'اليمن'],
  EGY: ['Egypt', 'مصر'],
  JOR: ['Jordan', 'الأردن'],
  SYR: ['Syria', 'سوريا'],
  LBN: ['Lebanon', 'لبنان'],
  PSE: ['Palestine', 'فلسطين'],
  IRQ: ['Iraq', 'العراق'],
  SDN: ['Sudan', 'السودان'],
  LBY: ['Libya', 'ليبيا'],
  TUN: ['Tunisia', 'تونس'],
  DZA: ['Algeria', 'الجزائر'],
  MAR: ['Morocco', 'المغرب'],
  IND: ['India', 'الهند'],
  PAK: ['Pakistan', 'باكستان'],
  BGD: ['Bangladesh', 'بنغلاديش'],
  PHL: ['Philippines', 'الفلبين'],
  IRN: ['Iran', 'إيران'],
  GBR: ['United Kingdom', 'المملكة المتحدة'],
  USA: ['United States', 'الولايات المتحدة'],
};

const formatEid = (s: string) => {
  const d = s.replace(/\D/g, '');
  return d.length === 15 ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7, 14)}-${d.slice(14)}` : s;
};

const mrzName = (s: string) => {
  const [surname, given = ''] = s.replace(/<+$/, '').split('<<');
  return titleCase(`${given.replace(/</g, ' ')} ${surname.replace(/</g, ' ')}`.replace(/\s+/g, ' ').trim().toUpperCase());
};

interface Mrz {
  type: 'passport' | 'id';
  name: string;
  number: string;
  nationality: string;
  eid?: string;
}

/** Machine-readable zone: passports (2 × 44) and ID cards (3 × 30). */
export function readMrz(textLines: string[]): Mrz | null {
  const cand = textLines.map((l) => l.replace(/\s+/g, '').toUpperCase()).filter((l) => /^[A-Z0-9<]{28,46}$/.test(l) && l.includes('<'));
  for (let i = 0; i + 1 < cand.length; i++) {
    const [a, b] = [cand[i], cand[i + 1]];
    if (a.startsWith('P') && a.length >= 43 && b.length >= 43) {
      return { type: 'passport', name: mrzName(a.slice(5)), number: b.slice(0, 9).replace(/<+$/, ''), nationality: b.slice(10, 13).replace(/</g, '') };
    }
    if (/^[IAC]/.test(a) && a.length >= 29 && i + 2 < cand.length) {
      const c = cand[i + 2];
      const eid = a.slice(15, 30).match(/784\d{12}/)?.[0];
      return { type: 'id', name: mrzName(c), number: a.slice(5, 14).replace(/<+$/, ''), nationality: b.slice(15, 18).replace(/</g, ''), eid: eid ? formatEid(eid) : undefined };
    }
  }
  return null;
}

const PERSON_RULES: LabelRule[] = [
  { field: 'name_ar', ar: ['الاسم', 'الإسم', 'اسم المالك', 'المالك', 'الاسم الكامل', 'اسم صاحب الطلب', 'اسم مقدم الطلب'], value: 'ar' },
  { field: 'name_en', en: ['Name', 'Full Name', 'Owner Name', "Owner's Name", 'Applicant Name', 'Name of Owner'], value: 'en' },
  { field: 'nationality_ar', ar: ['الجنسية'], value: 'ar' },
  { field: 'nationality_en', en: ['Nationality'], value: 'en' },
  { field: 'passport', ar: ['رقم الجواز', 'رقم جواز السفر'], en: ['Passport No', 'Passport Number', 'Passport No.'], value: 'any', pattern: /[A-Z0-9]{6,12}/ },
];

const FORM_RULES: LabelRule[] = [
  { field: 'plot_number', ar: ['رقم القسيمة', 'رقم الأرض', 'رقم الارض'], en: ['Plot No', 'Plot Number', 'Plot No.', 'Land No', 'Land No.'], value: 'any', pattern: /[0-9][0-9A-Za-z\-/]*/ },
  { field: 'municipality_project_number', ar: ['رقم المشروع بالبلدية', 'رقم المشروع في البلدية'], en: ['Municipality Project No', 'Municipality Project Number'], value: 'any', pattern: /[A-Za-z0-9][A-Za-z0-9\-/]*/ },
  { field: 'project_id', ar: ['رقم المشروع'], en: ['Project No', 'Project Number', 'Project ID'], value: 'any', pattern: /[A-Za-z0-9][A-Za-z0-9\-/]*/ },
  { field: 'contractor_name_ar', ar: ['اسم المقاول', 'المقاول'], value: 'ar' },
  { field: 'contractor_name_en', en: ['Contractor Name', "Contractor's Name", 'Contractor'], value: 'en' },
  { field: 'owner_phone', ar: ['رقم الهاتف', 'الهاتف', 'الهاتف المتحرك', 'رقم الجوال', 'الجوال', 'رقم المتحرك'], en: ['Mobile', 'Mobile No', 'Phone', 'Phone No', 'Tel', 'Telephone'], value: 'any', pattern: /\+?[\d][\d\s-]{6,}\d/ },
  { field: 'owner_email', ar: ['البريد الإلكتروني', 'البريد الالكتروني'], en: ['Email', 'E-mail', 'Email Address'], value: 'any', pattern: EMAIL },
];

/** First value per field over all pages. */
function labelsOnPages(pages: TextItem[][], rules: LabelRule[]) {
  const out: { field: string; value: string; label: string }[] = [];
  for (const page of pages) for (const f of readLabels(page, rules)) if (!out.some((o) => o.field === f.field)) out.push(f);
  return out;
}

function personFrom(pages: TextItem[][], textLines: string[], all: string): { person: Person | null; mrz: Mrz | null } {
  const mrz = readMrz(textLines);
  const got = Object.fromEntries(labelsOnPages(pages, PERSON_RULES).map((f) => [f.field, f.value]));
  const eid = all.match(EID)?.[0];
  const country = mrz ? COUNTRIES[mrz.nationality] : undefined;
  const person: Person = {
    ar: got.name_ar ?? '',
    en: got.name_en ? titleCase(got.name_en) : (mrz?.name ?? ''),
    id: eid ? formatEid(eid) : (mrz?.eid ?? mrz?.number ?? got.passport),
    nationalityAr: got.nationality_ar ?? country?.[1],
    nationalityEn: got.nationality_en ? titleCase(got.nationality_en) : country?.[0],
  };
  return { person: person.ar || person.en || person.id ? person : null, mrz };
}

/** Recognise and read one uploaded document (one text array per page). */
export function parseDocument(pages: TextItem[][]): DocumentImport {
  const flat = pages.flat();
  const all = flat.map((i) => i.str).join(' ');
  if (/land site plan|PROPERTY DETAILS/i.test(all) || /مخطط\s*أرض/.test(all)) {
    const sp = parseSitePlan(pages);
    return { kind: 'siteplan', label: KIND_LABELS.siteplan, values: sp.values, owners: sp.owners, notes: sp.notes };
  }
  const pageItems = pages.map(splitScripts);
  const textLines = pageItems.flatMap((p) => lines(p).map(lineText));
  // a table of people (heirs, owners, partners) — e.g. a power of attorney or كفالة papers
  // the table may continue over several pages (with or without a repeated header)
  const table: Person[] = [];
  let cols: TableColumns | null = null;
  for (const page of pageItems) {
    const res = readPeopleTable(page, cols ?? undefined);
    if (res.people.length) {
      table.push(...res.people);
      cols = res.cols;
    } else if (cols) {
      break; // the table ended on the previous page
    }
  }
  const { person, mrz } = table.length ? { person: null, mrz: readMrz(textLines) } : personFrom(pageItems, textLines, all);
  const isPassport = !table.length && (mrz?.type === 'passport' || /\bpassport\b|جواز\s*سفر/i.test(all));
  const isId = !table.length && !isPassport && (mrz?.type === 'id' || EID.test(all) || /identity card|resident identity|بطاقة\s*(ال)?هوية/i.test(all));
  const kind: DocumentKind = isPassport ? 'passport' : isId ? 'emirates_id' : 'document';
  const values: ExtractedValue[] = [];
  const notes: string[] = [];
  const title = /وكال[ةه]|power of attorney/i.test(all) ? 'Power of attorney / وكالة' : /كفال[ةه]/.test(all) ? 'كفالة' : KIND_LABELS[kind];
  const src = title.split(' / ')[0];
  const people = table.length ? table : person ? [person] : [];
  if (people.length) {
    const add = (field: string, list: (string | undefined)[], sep: string) => {
      const v = uniqueJoin(list.map((x) => x ?? ''), sep);
      if (v) values.push({ field, value: v, source: table.length ? `${src} · table of ${table.length}` : src });
    };
    add('owner_name_ar', people.map((p) => p.ar), ownersJoin.ar);
    add('owner_name_en', people.map((p) => p.en), ownersJoin.en);
    add('owner_id_number', people.map((p) => p.id), ' / ');
    add('owner_nationality_ar', people.map((p) => p.nationalityAr), ' / ');
    add('owner_nationality_en', people.map((p) => p.nationalityEn), ' / ');
    if (table.length > 1) notes.push(`${table.length} people found in the table; their names are listed side by side.`);
  }
  // other labelled fields (forms, كفالة papers…)
  for (const f of labelsOnPages(pageItems, FORM_RULES)) {
    if (!values.some((v) => v.field === f.field)) values.push({ field: f.field, value: f.value, source: f.label });
  }
  if (!values.some((v) => v.field === 'owner_email')) {
    const m = all.match(EMAIL);
    if (m) values.push({ field: 'owner_email', value: m[0], source: 'email address' });
  }
  if (!values.some((v) => v.field === 'owner_phone')) {
    const m = all.match(PHONE);
    if (m) values.push({ field: 'owner_phone', value: m[0].trim(), source: 'phone number' });
  }
  if (!flat.length) notes.push('This PDF has no readable text (it may be a scanned image).');
  else if (!values.length) notes.push('No known fields were found in this document.');
  return { kind, label: title, values, owners: people, notes };
}

/**
 * Combines several documents. The site plan's owner names win (official
 * spelling); otherwise the names from IDs/passports are listed side by side.
 * ID numbers and nationalities of several owners are joined.
 */
export function mergeImports(docs: { file: string; result: DocumentImport }[]): { values: ExtractedValue[]; notes: string[] } {
  const values: ExtractedValue[] = [];
  const notes: string[] = [];
  const ownerFields = new Set(['owner_name_ar', 'owner_name_en', 'owner_id_number', 'owner_nationality_ar', 'owner_nationality_en']);
  const site = docs.filter((d) => d.result.kind === 'siteplan');
  const people = docs.filter((d) => d.result.kind !== 'siteplan').flatMap((d) => d.result.owners.map((p) => ({ p, file: d.file })));

  // owners
  const siteOwners = site.flatMap((d) => d.result.owners);
  const namesFrom = siteOwners.length ? siteOwners : people.map((x) => x.p);
  const namesSrc = siteOwners.length ? site.map((d) => d.file).join(', ') : people.map((x) => x.file).join(', ');
  const nameAr = uniqueJoin(namesFrom.map((p) => p.ar), ownersJoin.ar);
  const nameEn = uniqueJoin(namesFrom.map((p) => p.en), ownersJoin.en);
  if (nameAr) values.push({ field: 'owner_name_ar', value: nameAr, source: namesSrc });
  if (nameEn) values.push({ field: 'owner_name_en', value: nameEn, source: namesSrc });
  const ids = uniqueJoin(people.map((x) => x.p.id ?? ''), ' / ');
  if (ids) values.push({ field: 'owner_id_number', value: ids, source: people.filter((x) => x.p.id).map((x) => x.file).join(', ') });
  const natAr = uniqueJoin(people.map((x) => x.p.nationalityAr ?? ''), ' / ');
  const natEn = uniqueJoin(people.map((x) => x.p.nationalityEn ?? ''), ' / ');
  if (natAr) values.push({ field: 'owner_nationality_ar', value: natAr, source: people.map((x) => x.file).join(', ') });
  if (natEn) values.push({ field: 'owner_nationality_en', value: natEn, source: people.map((x) => x.file).join(', ') });
  if (siteOwners.length && people.length) notes.push('Owner names are taken from the site plan; the IDs/passports add the ID numbers and nationalities.');

  // everything else: site plan first, then the other documents in upload order
  for (const d of [...site, ...docs.filter((x) => x.result.kind !== 'siteplan')]) {
    for (const v of d.result.values) {
      if (ownerFields.has(v.field)) continue;
      const existing = values.find((x) => x.field === v.field);
      if (!existing) values.push({ ...v, source: `${d.file} · ${v.source}` });
      else if (existing.value !== v.value) notes.push(`${d.file}: a different value for ${v.field.replace(/_/g, ' ')} ("${v.value}") was ignored.`);
    }
    for (const n of d.result.notes) notes.push(`${d.file}: ${n}`);
  }
  return { values, notes };
}
