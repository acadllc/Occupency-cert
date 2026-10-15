import type { Catalog, CompanyConfig, FieldRegistry, ProjectType } from '@acad/engine';
import catalogJson from '../../../../templates/dist/catalog.json';
import fieldsJson from '../../../../templates/fields.json';
import companyJson from '../../../../templates/company.json';
import projectTypesJson from '../../../../templates/project-types.json';

export const catalog = catalogJson as unknown as Catalog;
export const registry = fieldsJson as unknown as FieldRegistry;
export const company = companyJson as unknown as CompanyConfig;
export const projectTypes = projectTypesJson.types as ProjectType[];
export const projectTypeOf = (d: { projectType?: string }) => d.projectType ?? 'occupancy';

export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
export const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined;

/** In-memory demo/test backend; only ever enabled by an explicit build flag. */
export const MOCK_MODE = import.meta.env.VITE_DATA_MODE === 'mock';

export const assetUrl = (path: string) => `${import.meta.env.BASE_URL}${path}`;
