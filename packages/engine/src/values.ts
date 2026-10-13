import type { CompanyConfig, FieldDef, FieldRegistry, FieldValue, MappingItem, ProjectFields } from './types';

/**
 * Value expressions used in template mappings:
 *   "owner_name_ar"          project field (dates are printed DD/MM/YYYY)
 *   "city|ar" / "city|en"    localized option label of a select field
 *   "$consultant_name_en"    fixed company value (templates/company.json)
 *   "@project_location_ar"   derived value
 *   "{area_ar} - {sector_ar}" template string combining any of the above
 */
export interface ValueContext {
  fields: ProjectFields;
  registry: FieldRegistry;
  company: CompanyConfig;
}

const fieldIndex = new WeakMap<FieldRegistry, Map<string, FieldDef>>();

export function getField(registry: FieldRegistry, key: string): FieldDef | undefined {
  let idx = fieldIndex.get(registry);
  if (!idx) {
    idx = new Map(registry.fields.map((f) => [f.key, f]));
    fieldIndex.set(registry, idx);
  }
  return idx.get(key);
}

export function optionsOf(def: FieldDef, company: CompanyConfig) {
  if (def.options) return def.options;
  if (def.optionsFrom === 'company.cities') return company.cities;
  return [];
}

/** ISO yyyy-mm-dd -> dd/mm/yyyy (UAE convention). Anything else is returned unchanged. */
export function formatDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  return m ? `${m[3]}/${m[2]}/${m[1]}` : value.trim();
}

export function asText(v: FieldValue): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  return '';
}

function join(sep: string, parts: string[]): string {
  return parts.map((p) => p.trim()).filter(Boolean).join(sep);
}

function cityLabel(ctx: ValueContext, lang: 'ar' | 'en'): string {
  const v = asText(ctx.fields.city);
  const opt = ctx.company.cities.find((c) => c.value === v);
  return opt ? opt[lang] : v;
}

export function derivedValue(key: string, ctx: ValueContext): string {
  const f = (k: string) => asText(ctx.fields[k]);
  switch (key) {
    case 'city_ar':
      return cityLabel(ctx, 'ar');
    case 'city_en':
      return cityLabel(ctx, 'en');
    case 'project_location_ar': {
      const base = join(' / ', [cityLabel(ctx, 'ar'), f('area_ar'), join(' - ', [f('sector_ar'), f('plot_number')])]);
      const ref = f('reference_number');
      return ref ? join(' – ', [base, `الرقم المرجعي: ${ref}`]) : base;
    }
    case 'project_location_en': {
      const base = join(' / ', [cityLabel(ctx, 'en'), f('area_en'), join(' - ', [f('sector_en'), f('plot_number') && `Plot ${f('plot_number')}`])]);
      const ref = f('reference_number');
      return ref ? join(' – ', [base, `Ref. No.: ${ref}`]) : base;
    }
    case 'project_address_or_location_ar':
      return f('project_address_ar') || join(' / ', [cityLabel(ctx, 'ar'), f('area_ar'), join(' - ', [f('sector_ar'), f('plot_number')])]);
    case 'project_address_or_location_en':
      return (
        f('project_address_en') ||
        join(' / ', [cityLabel(ctx, 'en'), f('area_en'), join(' - ', [f('sector_en'), f('plot_number') && `Plot ${f('plot_number')}`])])
      );
    default:
      throw new Error(`Unknown derived value: ${key}`);
  }
}

function atom(expr: string, ctx: ValueContext): string {
  const e = expr.trim();
  if (e.startsWith('$')) {
    const v = (ctx.company as unknown as Record<string, unknown>)[e.slice(1)];
    if (typeof v !== 'string') throw new Error(`Unknown company value: ${e}`);
    return v;
  }
  if (e.startsWith('@')) return derivedValue(e.slice(1), ctx);
  const [key, mod] = e.split('|');
  const def = getField(ctx.registry, key);
  if (!def) throw new Error(`Unknown field in mapping: ${key}`);
  const raw = ctx.fields[key];
  if (def.type === 'date' || mod === 'date') return formatDate(asText(raw));
  if (mod === 'ar' || mod === 'en') {
    const opts = optionsOf(def, ctx.company);
    const values = Array.isArray(raw) ? (raw as string[]) : [asText(raw)];
    return values
      .map((v) => opts.find((o) => o.value === v)?.[mod] ?? v)
      .filter(Boolean)
      .join('، ');
  }
  if (Array.isArray(raw)) return '';
  return asText(raw);
}

export function resolveValue(expr: string, ctx: ValueContext): string {
  if (!expr.includes('{')) return atom(expr, ctx);
  let anyFilled = false;
  const out = expr.replace(/\{([^}]+)\}/g, (_, inner: string) => {
    const v = atom(inner, ctx);
    if (v) anyFilled = true;
    return v;
  });
  return anyFilled ? out.replace(/\s+/g, ' ').trim() : '';
}

/** Project field keys an expression depends on (company constants excluded). */
export function referencedFields(expr: string, registry: FieldRegistry): string[] {
  const atoms = expr.includes('{') ? [...expr.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]) : [expr];
  const keys: string[] = [];
  for (const a of atoms) {
    const e = a.trim();
    if (e.startsWith('$')) continue;
    if (e.startsWith('@')) {
      keys.push(...(registry.derived[e.slice(1)]?.from ?? []));
      continue;
    }
    keys.push(e.split('|')[0]);
  }
  return keys;
}

/** Field keys a mapping item reads. */
export function itemFields(item: MappingItem, registry: FieldRegistry): string[] {
  if ('value' in item) return referencedFields(item.value, registry);
  if ('en' in item && 'ar' in item) return [...referencedFields(item.en, registry), ...referencedFields(item.ar, registry)];
  if ('check' in item) return [item.check.field];
  if ('photo' in item) return [item.photo.field];
  if ('photoText' in item) return [item.photoText.field];
  return [];
}

export function isChecked(item: { check: { field: string; option?: string; equals?: string } }, fields: ProjectFields): boolean {
  const raw = fields[item.check.field];
  if (item.check.option !== undefined) {
    if (Array.isArray(raw)) return (raw as string[]).includes(item.check.option);
    return asText(raw) === item.check.option;
  }
  if (item.check.equals !== undefined) return asText(raw) === item.check.equals;
  return Boolean(asText(raw));
}

export function isEmptyValue(v: FieldValue): boolean {
  if (v == null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}
