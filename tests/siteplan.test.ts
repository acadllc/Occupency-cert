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
});
