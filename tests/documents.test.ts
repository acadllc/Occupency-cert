import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mergeImports, parseDocument, readMrz, type SitePlanTextItem } from '@acad/engine';

// All people, numbers and addresses below are fictional.
const t = (str: string, x: number, y: number, w = str.length * 5): SitePlanTextItem => ({ str, x, y, w });
const sitePlan = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'siteplan-items.json'), 'utf8')) as SitePlanTextItem[];

const emiratesId: SitePlanTextItem[] = [
  t('United Arab Emirates', 40, 30),
  t('بطاقة هوية', 400, 30, 40),
  t('Resident Identity Card', 40, 45),
  t('ID Number', 40, 80),
  t('784-1985-1234567-1', 100, 80, 90),
  t('رقم الهوية', 420, 80, 40),
  t('Name:', 40, 110, 28),
  t('Mohammed Khalifa Rashed Almansoori', 72, 110, 170),
  t('الاسم:', 440, 130, 22),
  t('محمد', 410, 130, 22),
  t('خليفة', 380, 130, 24),
  t('راشد', 350, 130, 22),
  t('المنصوري', 300, 130, 40),
  t('Nationality: United Arab Emirates', 40, 160, 160),
];

const passport: SitePlanTextItem[] = [
  t('PASSPORT', 40, 20),
  t('جواز سفر', 400, 20, 40),
  t('P<AREALMANSOORI<<FATIMA<KHALIFA<RASHED<<<<<<', 20, 300, 400),
  t('N123456780ARE8501011F3001017<<<<<<<<<<<<<<02', 20, 312, 400),
];

const kafala: SitePlanTextItem[] = [
  t('كفالة', 280, 20, 30),
  t('اسم المالك', 470, 60, 50),
  t(':', 462, 60, 3),
  t('سالم', 430, 60, 20),
  t('خليفة', 400, 60, 24),
  t('المنصوري', 350, 60, 40),
  t('رقم الهاتف', 470, 80, 50),
  t('050 123 4567', 380, 80, 60),
  t('البريد الإلكتروني', 470, 100, 60),
  t('salem@example.com', 330, 100, 90),
  t('رقم المشروع بالبلدية', 470, 120, 90),
  t('AD-77-2026', 330, 120, 50),
  t('Contractor Name', 40, 140, 70),
  t('Al Waha Building Contracting', 115, 140, 130),
];

describe('document import', () => {
  it('reads an Emirates ID (name in both languages, ID number, nationality)', () => {
    const r = parseDocument([emiratesId]);
    expect(r.kind).toBe('emirates_id');
    const v = Object.fromEntries(r.values.map((x) => [x.field, x.value]));
    expect(v.owner_name_en).toBe('Mohammed Khalifa Rashed Almansoori');
    expect(v.owner_name_ar).toBe('محمد خليفة راشد المنصوري');
    expect(v.owner_id_number).toBe('784-1985-1234567-1');
    expect(v.owner_nationality_en).toBe('United Arab Emirates');
  });

  it('reads a passport from its machine-readable lines', () => {
    expect(readMrz(['P<AREALMANSOORI<<FATIMA<KHALIFA<RASHED<<<<<<', 'N123456780ARE8501011F3001017<<<<<<<<<<<<<<02'])?.name).toBe('Fatima Khalifa Rashed Almansoori');
    const r = parseDocument([passport]);
    expect(r.kind).toBe('passport');
    const v = Object.fromEntries(r.values.map((x) => [x.field, x.value]));
    expect(v.owner_name_en).toBe('Fatima Khalifa Rashed Almansoori');
    expect(v.owner_id_number).toBe('N12345678');
    expect(v.owner_nationality_ar).toBe('الإمارات العربية المتحدة');
  });

  it('reads labelled fields from other forms (كفالة papers)', () => {
    const r = parseDocument([kafala]);
    expect(r.kind).toBe('document');
    const v = Object.fromEntries(r.values.map((x) => [x.field, x.value]));
    expect(v.owner_name_ar).toBe('سالم خليفة المنصوري');
    expect(v.owner_phone).toBe('050 123 4567');
    expect(v.owner_email).toBe('salem@example.com');
    expect(v.municipality_project_number).toBe('AD-77-2026');
    expect(v.project_id).toBeUndefined();
    expect(v.contractor_name_en).toBe('Al Waha Building Contracting');
    expect(v.owner_name_en).toBeUndefined(); // "Name" inside "Contractor Name" is not the owner
  });

  it('merges several documents: site plan names win, IDs add numbers, owners side by side', () => {
    const site = parseDocument([sitePlan]);
    const merged = mergeImports([
      { file: 'site-plan.pdf', result: site },
      { file: 'id.pdf', result: parseDocument([emiratesId]) },
      { file: 'passport.pdf', result: parseDocument([passport]) },
      { file: 'kafala.pdf', result: parseDocument([kafala]) },
    ]);
    const v = Object.fromEntries(merged.values.map((x) => [x.field, x.value]));
    expect(v.owner_name_ar).toBe('سالم خليفة راشد سالم المنصوري');
    expect(v.owner_id_number).toBe('784-1985-1234567-1 / N12345678');
    expect(v.plot_number).toBe('18-7-200-047');
    expect(v.owner_phone).toBe('050 123 4567');

    const idsOnly = mergeImports([
      { file: 'id.pdf', result: parseDocument([emiratesId]) },
      { file: 'passport.pdf', result: parseDocument([passport]) },
    ]);
    const w = Object.fromEntries(idsOnly.values.map((x) => [x.field, x.value]));
    expect(w.owner_name_en).toBe('Mohammed Khalifa Rashed Almansoori & Fatima Khalifa Rashed Almansoori');
  });

  it('reports a scan without text', () => {
    const r = parseDocument([[]]);
    expect(r.values).toHaveLength(0);
    expect(r.notes[0]).toMatch(/no readable text/);
  });

  it('reads a table of people over several pages (e.g. heirs in a power of attorney)', () => {
    // laid out like a notarised وكالة: م | الاسم | الجنسية | رقم الاثبات, with the lam-alef letters stored
    // in the wrong order ("االسم", "االمارات") as some PDF writers do; the table continues on page 2
    const header = [t('م', 559, 203, 4), t('االسم', 439, 205, 20), t('الجنسية', 300, 205, 30), t('رقم', 176, 205, 12), t('االثبات', 146, 205, 26)];
    const row = (n: number, name: string, id: string, y: number) => [
      t(String(n), 554, y, 5),
      t(name, 380, y, 126),
      t('ات', 297.5, y, 9.5),
      t('االمار', 304.5, y, 19.8),
      t(id, 121, y, 83),
    ];
    const page1 = [
      t('وكالة عامة', 300, 146, 60),
      t('نحن الموقعين ادناه بصفتنا احد ورثة المتوفي', 300, 167, 260),
      ...header,
      ...row(1, 'محمد راشد سالم المنصوري', '784198500000011', 228),
      ...row(2, 'عبدهللا راشد سالم المنصوري', '784198600000022', 246),
      t('نقر على نفسنا ونحن في الحالة المعتبرة شرعا وقانونا والتي تسمح لنا باإلقرار ونفاذ التصرفات', 60, 268, 500),
    ];
    const page2 = [...row(3, 'مريم راشد سالم المنصوري', '784199000000033', 60), t('لينوب عنا ويقوم مقامنا ويمثلنا فيما يلي على جميع ما آل لنا', 60, 90, 500)];
    const r = parseDocument([page1, page2]);
    expect(r.kind).toBe('document');
    expect(r.label).toBe('Power of attorney / وكالة');
    expect(r.owners).toHaveLength(3);
    const v = Object.fromEntries(r.values.map((x) => [x.field, x.value]));
    expect(v.owner_name_ar).toBe('محمد راشد سالم المنصوري و عبدالله راشد سالم المنصوري و مريم راشد سالم المنصوري');
    expect(v.owner_id_number).toBe('784-1985-0000001-1 / 784-1986-0000002-2 / 784-1990-0000003-3');
    expect(v.owner_nationality_ar).toBe('الامارات');
  });
});

describe('download names', async () => {
  const { downloadName } = await import('../apps/web/src/lib/files');
  const catalog = JSON.parse(readFileSync(join(__dirname, '..', 'templates', 'dist', 'catalog.json'), 'utf8')) as {
    templates: { definition: { key: string; source: string; fileName?: string } }[];
  };
  const def = (key: string) => catalog.templates.find((t) => t.definition.key === key)?.definition;

  it('gives back the name of the original file', () => {
    expect(downloadName(def('mechanical-commitment'), 'x.pdf', 'pdf')).toBe('01Mechanical systemتعهد بالالتزام ببنود كود أبو ظبي للأعمال الميكانيكية.pdf');
    expect(downloadName(def('no-elevators'), 'x.docx', 'docx')).toBe('عدم وجود مصاعد في المشروع.docx');
    expect(downloadName(def('no-elevators'), 'x.pdf', 'pdf')).toBe('عدم وجود مصاعد في المشروع.pdf');
    expect(downloadName(def('occupant-load'), 'x.docx', 'docx')).toBe('OCCUPANT LOAD.docx');
    expect(downloadName(def('bank-com-complete-per-drawings'), 'x.pdf', 'pdf')).toBe('تعهد إستكمال حسب المخططات والمواصفات.pdf');
    expect(downloadName(undefined, 'stored-name.pdf', 'pdf')).toBe('stored-name.pdf');
  });

  it('names every template', () => {
    for (const { definition } of catalog.templates) expect(downloadName(definition, '', 'pdf')).toMatch(/^[^\\/:*?"<>|]+\.pdf$/);
  });
});
