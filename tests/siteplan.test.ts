import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSitePlan, type SitePlanTextItem } from '@acad/engine';

// Text layout of an Abu Dhabi Real Estate Centre site plan with fictional owner/plot values.
const items = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'siteplan-items.json'), 'utf8')) as SitePlanTextItem[];

describe('site plan import', () => {
  it('extracts location, plot, usage and owner in both languages', () => {
    const r = parseSitePlan(items);
    expect(r.recognised).toBe(true);
    expect(r.fields).toEqual({
      city: 'al_ain',
      area_en: 'Central District',
      area_ar: 'وسط المدينة',
      sector_en: 'Hai Al Humaira',
      sector_ar: 'حي الحميرة',
      plot_number: '18-7-200-047',
      land_building_usage_en: 'Commercial',
      land_building_usage_ar: 'تجاري',
      owner_name_ar: 'سالم خليفة راشد سالم المنصوري',
      owner_name_en: 'Salem Khalifa Rashed Salem Almansoori',
    });
  });

  it('ignores the map legend words that repeat the row labels', () => {
    const r = parseSitePlan(items);
    expect(r.fields.area_en).not.toMatch(/sector/i);
  });

  it('reports unrelated documents', () => {
    const r = parseSitePlan([{ str: 'Invoice', x: 10, y: 10, w: 40 }]);
    expect(r.recognised).toBe(false);
    expect(r.values).toHaveLength(0);
  });

  it('reads owners from every page (many owners) and lists them side by side', () => {
    // page 2 continues the owners table without a header: rows 2 and 3
    const row = (n: number, ar: string[], en: string, y: number): SitePlanTextItem[] => [
      { str: String(n), x: 816.8, y: y + 9, w: 3.9 },
      ...ar.map((w, i) => ({ str: w, x: 790 - i * 20, y, w: 16 })),
      { str: en, x: 706, y: y + 9, w: 88 },
    ];
    const page2 = [...row(2, ['محمد', 'خليفة', 'المنصوري'], 'MOHAMMED KHALIFA ALMANSOORI', 60), ...row(3, ['فاطمة', 'خليفة', 'المنصوري'], 'FATIMA KHALIFA ALMANSOORI', 120)];
    const r = parseSitePlan([items, page2]);
    expect(r.owners).toHaveLength(3);
    expect(r.fields.owner_name_ar).toBe('سالم خليفة راشد سالم المنصوري و محمد خليفة المنصوري و فاطمة خليفة المنصوري');
    expect(r.fields.owner_name_en).toBe('Salem Khalifa Rashed Salem Almansoori & Mohammed Khalifa Almansoori & Fatima Khalifa Almansoori');
    expect(r.notes.join(' ')).toMatch(/3 owners found on 2 pages/);
    // property details still come from page 1
    expect(r.fields.plot_number).toBe('18-7-200-047');
  });
});
