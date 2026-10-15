import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
  Engine,
  analyzeMissing,
  defaultFields,
  formatDate,
  isGeneratable,
  resolveValue,
  stampBox,
  templateSpecificFields,
  validateFields,
  type Catalog,
  type CompanyConfig,
  type FieldRegistry,
  type ProjectFields,
} from '@acad/engine';
import { longProject, sampleProject } from './fixtures/sample-projects';
import { nodeAssets } from './node-assets';

const root = join(__dirname, '..');
const read = (p: string) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const registry = read('templates/fields.json') as FieldRegistry;
const company = read('templates/company.json') as CompanyConfig;
const catalog = read('templates/dist/catalog.json') as Catalog;
const ctx = (fields: ProjectFields) => ({ fields, registry, company });

const photos: Record<string, Uint8Array> = {};
for (const n of [1, 2, 3]) photos[`test/photo${n}.jpg`] = new Uint8Array(readFileSync(join(root, 'tests/fixtures/photos', `photo${n}.jpg`)));

let engine: Engine;
beforeAll(async () => {
  engine = await Engine.create(nodeAssets(root, photos), registry, company, catalog);
});

describe('field values', () => {
  it('formats dates DD/MM/YYYY', () => {
    expect(formatDate('2026-03-07')).toBe('07/03/2026');
    expect(formatDate('')).toBe('');
  });

  it('keeps project and plot numbers exactly as typed', () => {
    const f = { ...sampleProject, project_id: '00012-B/7', plot_number: '079-01-068-4' };
    expect(resolveValue('project_id', ctx(f))).toBe('00012-B/7');
    expect(resolveValue('plot_number', ctx(f))).toBe('079-01-068-4');
  });

  it('derives the Arabic and English project location', () => {
    expect(resolveValue('@project_location_ar', ctx(sampleProject))).toBe('العين / الهيلي / شرق 12 - 047');
    expect(resolveValue('@project_location_en', ctx(sampleProject))).toBe('Al Ain / Al Hili / East 12 - Plot 047');
    expect(resolveValue('@project_location_ar', ctx({ city: 'abu_dhabi', area_ar: 'السعادة' }))).toBe('أبوظبي / السعادة');
    expect(resolveValue('@project_location_ar', ctx({}))).toBe('');
  });

  it('prefers an explicit address override', () => {
    expect(resolveValue('@project_address_or_location_ar', ctx({ ...sampleProject, project_address_ar: 'عنوان خاص' }))).toBe('عنوان خاص');
  });

  it('uses fixed company names', () => {
    expect(resolveValue('$consultant_name_en', ctx({}))).toBe('ACAD Engineering Consultants - One Person Company LLC');
    expect(resolveValue('$consultant_name_ar', ctx({}))).toBe('اكاد للاستشارات الهندسيه - شركة الشخص الواحد ذ.م.م');
  });

  it('supports conditional expressions', () => {
    const expr = 'applicant_role=contractor ? contractor_name_ar : $consultant_name_ar';
    expect(resolveValue(expr, ctx({ ...sampleProject, applicant_role: 'contractor' }))).toBe(sampleProject.contractor_name_ar);
    expect(resolveValue(expr, ctx({ ...sampleProject, applicant_role: 'consultant' }))).toBe(company.consultant_name_ar);
  });

  it('localises select options', () => {
    expect(resolveValue('city|ar', ctx({ city: 'abu_dhabi' }))).toBe('أبوظبي');
    expect(resolveValue('city|en', ctx({ city: 'al_ain' }))).toBe('Al Ain');
  });

  it('never prints undefined/null', () => {
    for (const k of ['owner_name_ar', 'date', 'city|en', '@project_location_en']) {
      const v = resolveValue(k, ctx({ owner_name_ar: null, date: undefined }));
      expect(v).not.toMatch(/undefined|null|object/);
    }
  });

  it('validates lengths and control characters', () => {
    expect(validateFields(registry, { owner_name_ar: 'x'.repeat(1100) }).owner_name_ar).toBeTruthy();
    expect(validateFields(registry, { owner_email: 'not-an-email' }).owner_email).toBeTruthy();
    expect(validateFields(registry, { owner_phone: 'call me' }).owner_phone).toBeTruthy();
    expect(validateFields(registry, { owner_email: 'owner@example.com', owner_phone: '+971 50 123 4567' })).toEqual({});
    expect(validateFields(registry, { owner_name_en: 'bad\u0007' }).owner_name_en).toBeTruthy();
    expect(validateFields(registry, sampleProject)).toEqual({});
  });

  it('applies defaults', () => {
    const d = defaultFields(registry, new Date('2026-10-13T08:00:00Z'));
    expect(d.date).toBe('2026-10-13');
    expect(d.city).toBe('al_ain');
  });
});

describe('registry', () => {
  it('lists all 18 reference templates as generatable', () => {
    expect(catalog.templates).toHaveLength(18);
    expect(catalog.templates.every(isGeneratable)).toBe(true);
  });

  it('shows template-specific fields only for selected templates', () => {
    const keys = templateSpecificFields(['elevators-testing'], registry).map((f) => f.key);
    expect(keys).toContain('elevator_model_en');
    expect(keys).not.toContain('mech_authorization_type');
    expect(templateSpecificFields([], registry)).toHaveLength(0);
  });

  it('reports missing fields per template without blocking', () => {
    const m = analyzeMissing(['number-of-users', 'mechanical-commitment'], catalog, registry, {});
    const owner = m.required.find((x) => x.field.key === 'owner_name_ar');
    expect(owner?.templates.sort()).toEqual(['mechanical-commitment', 'number-of-users']);
    expect(m.optional.some((x) => x.field.key === 'developer_name_en')).toBe(true);
    expect(analyzeMissing(['number-of-users'], catalog, registry, sampleProject).required).toHaveLength(0);
  });
});

describe('PDF generation', () => {
  for (const { definition, layout } of catalog.templates) {
    it(`${definition.key}: generates with sample, long and empty data`, async () => {
      for (const fields of [sampleProject, longProject, {}]) {
        const res = await engine.generate(definition.key, fields);
        const pdf = await PDFDocument.load(res.bytes);
        expect(pdf.getPageCount()).toBe(res.pageCount);
        if (!definition.trimEmptyPhotoPages) expect(res.pageCount).toBe(layout.pageCount);
        const p0 = pdf.getPage(0);
        expect(Math.round(p0.getWidth())).toBe(Math.round(layout.pages[0].width));
        expect(Math.round(p0.getHeight())).toBe(Math.round(layout.pages[0].height));
        expect(pdf.getTitle()).toBeTruthy();
        for (const pl of res.placements) expect(pl.text ?? '').not.toMatch(/undefined|null|\[object/);
        if (fields === sampleProject) expect(res.warnings.filter((w) => w.code !== 'overflow')).toEqual([]);
        if (Object.keys(fields).length === 0) expect(res.placements.filter((p) => p.kind === 'photo')).toHaveLength(0);
      }
    });
  }

  it('maps Arabic values to Arabic slots and English values to English slots', async () => {
    const res = await engine.generate('mechanical-commitment', sampleProject);
    const text = (slot: string) => res.placements.find((p) => p.slot === slot)?.text;
    expect(text('owner (English)')).toBe(sampleProject.owner_name_en);
    expect(text('owner (Arabic)')).toBe(sampleProject.owner_name_ar);
    expect(text('ack_en')).toBe(sampleProject.contractor_name_en);
    expect(text('ack_ar')).toBe(sampleProject.contractor_name_ar);
    expect(text('pledge_en')).toBe(company.consultant_name_en);
    expect(text('project_id_en')).toBe('B2N-2026-000123');
    expect(text('project_id_ar')).toBe('B2N-2026-000123');
    expect(text('date_en')).toBe('13/10/2026');
  });

  it('ticks only the selected options', async () => {
    const res = await engine.generate('mechanical-commitment', sampleProject);
    const checks = res.placements.filter((p) => p.kind === 'check').map((p) => p.slot).sort();
    expect(checks).toEqual(['auth_supply_ar', 'auth_supply_en', 'auth_testing_maintenance_ar', 'auth_testing_maintenance_en', 'device_routine_inspection_ar', 'device_routine_inspection_en']);
  });

  it('repeats shared values on every page where they appear', async () => {
    const res = await engine.generate('consultant-authorization', sampleProject);
    const consultant = res.placements.filter((p) => p.text === company.consultant_name_en);
    expect(consultant.map((p) => p.page).sort()).toEqual([0, 1]);
  });

  it('places Arabic letter values in the right table cells', async () => {
    const res = await engine.generate('number-of-users', sampleProject);
    const bySlot = Object.fromEntries(res.placements.map((p) => [p.slot, p.text]));
    expect(bySlot).toMatchObject({
      owner: sampleProject.owner_name_ar,
      consultant: company.consultant_name_ar,
      components: sampleProject.project_components_ar,
      users: sampleProject.number_of_users_ar,
      date: '13/10/2026',
    });
  });

  it('embeds photos and trims unused photo pages', async () => {
    const res = await engine.generate('photo-report-plumbing', sampleProject);
    expect(res.placements.filter((p) => p.kind === 'photo')).toHaveLength(3);
    expect(res.pageCount).toBe(2);
    const empty = await engine.generate('photo-report-plumbing', {});
    expect(empty.pageCount).toBe(4);
  });

  it('warns (never throws) when text cannot fit', async () => {
    const res = await engine.generate('number-of-users', { ...sampleProject, owner_name_ar: 'اسم '.repeat(2000) });
    expect(res.warnings.some((w) => w.code === 'overflow' && w.slot === 'owner')).toBe(true);
  });

  it('subsets fonts (small output)', async () => {
    // the letterhead image dominates the size; the embedded fonts must stay small subsets
    const res = await engine.generate('owner-undertaking-cd-renewal', sampleProject);
    const base = readFileSync(join(root, 'templates/dist/owner-undertaking-cd-renewal.pdf')).length;
    expect(res.bytes.length - base).toBeLessThan(120_000);
  });
});

describe('many owners', () => {
  it('fits four owners in every template with a smaller font instead of overflowing', async () => {
    const fields = {
      ...sampleProject,
      owner_name_ar: 'سالم خليفة راشد المنصوري و محمد خليفة راشد المنصوري و فاطمة خليفة راشد المنصوري و عائشة خليفة راشد المنصوري',
      owner_name_en: 'Salem Khalifa Rashed Almansoori & Mohammed Khalifa Rashed Almansoori & Fatima Khalifa Rashed Almansoori & Aysha Khalifa Rashed Almansoori',
    };
    for (const { definition } of catalog.templates) {
      const res = await engine.generate(definition.key, fields);
      expect(res.warnings.filter((w) => w.code === 'overflow' && /owner/.test(w.slot ?? '')), definition.key).toEqual([]);
    }
  });
});

describe('very many owners', () => {
  it('prints every owner in a small font (no "and others"), even 12 owners in a one-line form box', async () => {
    const fields = {
      ...sampleProject,
      owner_name_en: '',
      owner_name_ar: Array.from({ length: 12 }, (_, i) => `مالك ${i + 1} راشد سالم بن خليفة المنصوري`).join(' و '),
    };
    for (const key of ['water-validity', 'archive-drawings-explanation', 'number-of-users']) {
      const res = await engine.generate(key, fields);
      expect(res.warnings.filter((w) => w.code === 'overflow'), key).toEqual([]);
      const owner = res.placements.find((p) => /^owner/.test(p.slot));
      expect(owner?.text, key).toContain('مالك 12');
      expect(owner?.text, key).not.toMatch(/وآخرون|others/);
    }
  });
});

describe('company stamp', () => {
  it('is added only when requested and only where the template defines it', async () => {
    const withStamp = await engine.generate('drainage-inspection-report', sampleProject, { stamp: true });
    expect(withStamp.placements.filter((p) => p.kind === 'stamp')).toHaveLength(1);
    const without = await engine.generate('drainage-inspection-report', sampleProject);
    expect(without.placements.filter((p) => p.kind === 'stamp')).toHaveLength(0);
    const ownerOnly = await engine.generate('owner-undertaking-cd-renewal', sampleProject, { stamp: true });
    expect(ownerOnly.placements.filter((p) => p.kind === 'stamp')).toHaveLength(0);
    const photoReport = await engine.generate('photo-report-mechanical', sampleProject, { stamp: true });
    expect(photoReport.placements.filter((p) => p.kind === 'stamp')).toHaveLength(1);
    // photo reports: signature at the bottom of the LAST remaining page
    const plumbing = await engine.generate('photo-report-plumbing', sampleProject, { stamp: true });
    expect(plumbing.placements.find((p) => p.kind === 'stamp')?.page).toBe(plumbing.pageCount - 1);
    const photoReportWord = await engine.generateDocx('photo-report-mechanical', sampleProject, { stamp: true });
    expect(photoReportWord.placements.filter((p) => p.kind === 'stamp')).toHaveLength(1);
  });

  it('is placed beside the consultant label on letters', () => {
    const slot = { page: 0, rect: [200, 380, 250, 400] as [number, number, number, number] };
    expect(stampBox(slot, { slot: 'stamp', stamp: { size: 110, anchor: 'right', dx: 6 } })).toEqual({ cx: 311, cy: 390, size: 110 });
  });

  it('warns instead of failing when no stamp image has been uploaded', async () => {
    const assets = nodeAssets(root, photos);
    const bare = await Engine.create({ ...assets, loadStamp: () => Promise.reject(new Error('none uploaded')) }, registry, company, catalog);
    const res = await bare.generate('number-of-users', sampleProject, { stamp: true });
    expect(res.placements.filter((p) => p.kind === 'stamp')).toHaveLength(0);
    expect(res.warnings.some((w) => /Stamp and signature could not be added/.test(w.message))).toBe(true);
  });
});

describe('Word output', () => {
  const JSZipP = import('jszip');
  const docxTemplates = catalog.templates.filter((t) => t.layout.docx);

  it('is available for every Word-based template and not for PDF forms', () => {
    expect(docxTemplates.map((t) => t.definition.format)).toEqual(docxTemplates.map(() => 'docx'));
    expect(docxTemplates).toHaveLength(catalog.templates.filter((t) => t.definition.format === 'docx').length);
    expect(engine.supportsDocx('mechanical-commitment')).toBe(false);
  });

  for (const { definition } of catalog.templates.filter((t) => t.layout.docx)) {
    it(`${definition.key}: fills every marker and leaves none behind`, async () => {
      const res = await engine.generateDocx(definition.key, sampleProject, { stamp: true });
      expect(res.format).toBe('docx');
      const { default: JSZip } = await JSZipP;
      const zip = await JSZip.loadAsync(res.bytes);
      const xml = await zip.file('word/document.xml')!.async('string');
      expect(xml).not.toMatch(/QZ\d+ZQ/);
      expect(xml).not.toContain('w:val="FFFFFF"/><w:t');
      const used = new Set(definition.fields.map((f) => f.slot));
      if (used.has('owner')) expect(xml).toContain(String(sampleProject.owner_name_ar));
      if (used.has('consultant')) expect(xml).toContain(company.consultant_name_ar);
      if (used.has('date')) expect(xml).toContain('13/10/2026');
    });
  }

  it('ticks the right Word check box and embeds photos and the stamp', async () => {
    const { default: JSZip } = await JSZipP;
    const arch = await JSZip.loadAsync((await engine.generateDocx('occupancy-undertaking-str-arch', sampleProject, { stamp: true })).bytes);
    const archXml = await arch.file('word/document.xml')!.async('string');
    const boxes = [...archXml.matchAll(/[☐☑]/g)].map((m) => m[0]);
    expect(boxes).toEqual(['☐', '☑']); // contractor unticked, consultant ticked
    expect(archXml).toContain('Company stamp');
    const photo = await JSZip.loadAsync((await engine.generateDocx('photo-report-plumbing', sampleProject)).bytes);
    expect(Object.keys(photo.files).filter((n) => n.startsWith('word/media/acad-'))).toHaveLength(3);
    const pxml = await photo.file('word/document.xml')!.async('string');
    expect(pxml).toContain('تم تركيب خزانات المياه العلوية');
  });

  it('escapes XML special characters in values', async () => {
    const { default: JSZip } = await JSZipP;
    const res = await engine.generateDocx('number-of-users', { ...sampleProject, owner_name_ar: 'A & B <test>' });
    const xml = await (await JSZip.loadAsync(res.bytes)).file('word/document.xml')!.async('string');
    expect(xml).toContain('A &amp; B &lt;test&gt;');
  });
});
