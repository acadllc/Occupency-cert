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
  /** extra validation for text fields */
  format?: 'email' | 'phone';
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
  /** suggested captions for photo details */
  detailOptions?: string[];
  placeholder?: string;
  help?: string;
  pair?: string;
}

export interface ProjectType {
  key: string;
  en: string;
  ar: string;
  /** display order of the document categories in this tab */
  categories?: string[];
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

export type FontFamily = 'sans' | 'naskh' | 'kufi' | 'din' | 'carlito' | 'tajawal' | 'amiri';

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
  /** Paint white over the whole slot before drawing (e.g. replaces a dotted __/__/____ date line). */
  knockoutSlot?: boolean;
  color?: [number, number, number];
  lineHeight?: number;
}

export interface TextItem extends TextStyle {
  slot: string;
  value: string;
  /** Word output: width (pt) the value may take; a longer value gets a smaller font (e.g. a fixed-size text box). */
  docxMaxWidth?: number;
}

export interface BilingualItem extends TextStyle {
  slot: string;
  en: string;
  ar: string;
  gap?: number;
}

export interface CheckItem {
  slot: string;
  /** Word output: index of the "☐" glyph (document order) that this check replaces */
  docxGlyph?: number;
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

/** Company stamp (drawn only when the stamp option is on). */
export interface StampItem {
  slot: string;
  stamp: {
    size: number;
    /** center of the slot rect, or right edge/baseline of a text marker plus dx/dy */
    anchor?: 'center' | 'marker' | 'right' | 'below';
    dx?: number;
    dy?: number;
    /** "last": on the last page that remains (photo reports drop unused pages); "every": on every page */
    page?: 'last' | 'every';
  };
}

export type MappingItem = TextItem | BilingualItem | CheckItem | PhotoItem | PhotoTextItem | StampItem;

export interface GenerateOptions {
  title?: string;
  /** add the company stamp where the template defines a stamp position */
  stamp?: boolean;
}

export type TemplateStatus = 'draft' | 'needs_review' | 'verified' | 'active' | 'retired';

export interface TemplateDefinition {
  key: string;
  version: number;
  status: TemplateStatus;
  name: string;
  nameAr?: string;
  description?: string;
  category?: string;
  /** picker tab (templates/project-types.json); default "occupancy" */
  projectType?: string;
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
  /** present for Word-based templates: marker text -> slot name in the editable DOCX */
  docx?: { markers: Record<string, string> } | null;
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

/** What was drawn where (used by tests and the per-document checklist). */
export interface Placement {
  slot: string;
  page: number;
  kind: 'text' | 'check' | 'photo' | 'stamp';
  text?: string;
  size?: number;
}

export interface GeneratedDocument {
  format: 'pdf' | 'docx';
  placements: Placement[];
  templateKey: string;
  templateVersion: number;
  bytes: Uint8Array;
  pageCount: number;
  warnings: GenerationWarning[];
}
