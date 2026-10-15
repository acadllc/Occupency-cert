import { getField, isEmptyValue, itemFields } from './values';
import type { Catalog, CatalogEntry, FieldDef, FieldRegistry, ProjectFields } from './types';

/** Templates that may be used for routine generation. */
export function isGeneratable(entry: CatalogEntry): boolean {
  return entry.definition.status === 'verified' || entry.definition.status === 'active';
}

/** Field keys read by a template (expanded through derived values). */
export function templateFieldKeys(entry: CatalogEntry, registry: FieldRegistry): string[] {
  const keys = new Set<string>();
  for (const item of entry.definition.fields) for (const k of itemFields(item, registry)) keys.add(k);
  return [...keys];
}

/** Template-scoped fields to show for the selected templates, in registry order. */
export function templateSpecificFields(selected: string[], registry: FieldRegistry): FieldDef[] {
  return registry.fields.filter((f) => f.scope === 'template' && f.templates?.some((t) => selected.includes(t)));
}

export interface MissingField {
  field: FieldDef;
  templates: string[];
}

/** Empty inputs used by the selected templates (warn-only; generation may continue). */
export function analyzeMissing(selected: string[], catalog: Catalog, registry: FieldRegistry, fields: ProjectFields) {
  const byKey = new Map<string, MissingField>();
  for (const key of selected) {
    const entry = catalog.templates.find((t) => t.definition.key === key);
    if (!entry) continue;
    for (const k of templateFieldKeys(entry, registry)) {
      const def = getField(registry, k);
      if (!def || !isEmptyValue(fields[k])) continue;
      const m = byKey.get(k) ?? { field: def, templates: [] };
      m.templates.push(key);
      byKey.set(k, m);
    }
  }
  const all = [...byKey.values()];
  return {
    required: all.filter((m) => !m.field.optional),
    optional: all.filter((m) => m.field.optional),
  };
}

/** Apply registry defaults ("today" for dates) to a fresh project. */
export function defaultFields(registry: FieldRegistry, today = new Date()): ProjectFields {
  const out: ProjectFields = {};
  for (const f of registry.fields) {
    if (f.default === undefined) continue;
    out[f.key] = f.default === 'today' ? today.toISOString().slice(0, 10) : f.default;
  }
  return out;
}

/** Light validation; returns messages for values that would make output unsafe. */
export function validateFields(registry: FieldRegistry, fields: ProjectFields): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of registry.fields) {
    const v = fields[f.key];
    if (typeof v === 'string') {
      if (f.maxLength && v.length > f.maxLength) errors[f.key] = `Maximum ${f.maxLength} characters.`;
      if (f.type === 'date' && v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) errors[f.key] = 'Invalid date.';
      if (f.format === 'email' && v.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())) errors[f.key] = 'Enter a valid email address.';
      if (f.format === 'phone' && v.trim() && !/^\+?[\d\s()/-]{7,}$/.test(v.trim())) errors[f.key] = 'Enter a valid phone number.';
      // control characters break PDF text and are never legitimate input
      if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(v)) errors[f.key] = 'Contains invalid control characters.';
    }
    if (f.type === 'photos' && Array.isArray(v) && f.maxItems && v.length > f.maxItems) errors[f.key] = `Maximum ${f.maxItems} photos.`;
  }
  return errors;
}
