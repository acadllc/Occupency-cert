/** Shared types for the field registry, template catalog and generator. */

export type Dir = 'rtl' | 'ltr';

export type FieldType = 'text' | 'textarea' | 'date' | 'select' | 'multiselect' | 'yesno' | 'photos';

export interface FieldOption {
  value: string;
  en: string;
  ar: string;
}

export interface FieldDef {
  key: string;
  label: string;
  labelAr?: string;
  type: FieldType;
  dir?: Dir;
  group: string;
  scope: 'shared' | 'template';
  templates?: string[];
  options?: FieldOption[];
  optionsFrom?: string;
  default?: string;
  optional?: boolean;
  maxLength?: number;
  maxItems?: number;
  placeholder?: string;
  help?: string;
  pair?: string;
}

export interface FieldGroup {
  key: string;
  label: string;
}

export interface DerivedDef {
  label: string;
  from: string[];
}

export interface FieldRegistry {
  groups: FieldGroup[];
  fields: FieldDef[];
  derived: Record<string, DerivedDef>;
}

export interface CompanyConfig {
  consultant_name_en: string;
  consultant_name_ar: string;
  cities: FieldOption[];
}

/** A photo entry stored on the project (photo report templates). */
export interface PhotoEntry {
  path: string;
  details_ar?: string;
  notes_ar?: string;
}

export type FieldValue = string | string[] | PhotoEntry[] | null | undefined;
export type ProjectFields = Record<string, FieldValue>;

export type FontFamily = 'sans' | 'naskh' | 'kufi' | 'carlito' | 'tajawal' | 'amiri';

export interface TextStyle {
  font?: FontFamily;
  bold?: boolean;
  size?: number;
  minSize?: number;
  align?: 'left' | 'right' | 'center' | 'start' | 'end';
  dir?: Dir | 'auto';
  valign?: 'baseline' | 'middle' | 'top';
  multiline?: boolean;
  padding?: [number, number, number, number];
  /** Paint white behind the text (hides dotted leader lines under the value). */
  knockout?: boolean;
  color?: [number, number, number];
  lineHeight?: number;
}

export interface TextItem extends TextStyle {
  slot: string;
  value: string;
}

export interface BilingualItem extends TextStyle {
  slot: string;
  en: string;
  ar: string;
  gap?: number;
}

export interface CheckItem {
  slot: string;
  check: { field: string; option?: string; equals?: string };
  style?: 'tick' | 'dot' | 'cross';
  size?: number;
}

export interface PhotoItem {
  slot: string;
  photo: { field: string; index: number };
  padding?: number;
}

export interface PhotoTextItem extends TextStyle {
  slot: string;
  photoText: { field: string; index: number; prop: 'details_ar' | 'notes_ar' };
}

export type MappingItem = TextItem | BilingualItem | CheckItem | PhotoItem | PhotoTextItem;

export type TemplateStatus = 'draft' | 'needs_review' | 'verified' | 'active' | 'retired';

export interface TemplateDefinition {
  key: string;
  version: number;
  status: TemplateStatus;
  name: string;
  nameAr?: string;
  description?: string;
  category?: string;
  source: string;
  format: 'pdf' | 'docx';
  reviewNotes?: string;
  /** Drop trailing pages whose photo slots are all empty (photo reports). */
  trimEmptyPhotoPages?: { field: string; slotsPerPage: number[] };
  fields: MappingItem[];
}

export interface SlotGeometry {
  page: number;
  /** [x0, y0, x1, y1] in points, TOP-LEFT origin. */
  rect: [number, number, number, number];
  baseline?: number;
  size?: number;
}

export interface TemplateLayout {
  key: string;
  version: number;
  format: 'pdf' | 'docx';
  sourceSha256: string;
  baseSha256: string;
  pageCount: number;
  pages: { width: number; height: number }[];
  slots: Record<string, SlotGeometry>;
}

export interface CatalogEntry {
  definition: TemplateDefinition;
  layout: TemplateLayout;
}

export interface Catalog {
  templates: CatalogEntry[];
}

export interface GenerationWarning {
  code: 'overflow' | 'missing_value' | 'missing_glyph' | 'image_error';
  slot?: string;
  field?: string;
  message: string;
}

export interface GeneratedDocument {
  templateKey: string;
  templateVersion: number;
  bytes: Uint8Array;
  pageCount: number;
  warnings: GenerationWarning[];
}
