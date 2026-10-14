import type { GenerationWarning, ProjectFields } from '@acad/engine';
import { supabase } from './supabase';

export interface Project {
  id: string;
  fields: ProjectFields;
  status: 'active' | 'archived';
  revision: number;
  created_at: string;
  updated_at: string;
  project_id: string | null;
  owner_name_ar: string | null;
  owner_name_en: string | null;
  plot_number: string | null;
}

export interface GenerationJob {
  id: string;
  project_id: string;
  project_revision: number;
  requested_templates: string[];
  status: 'running' | 'completed' | 'partial' | 'failed';
  warnings: unknown[];
  errors: unknown[];
  created_at: string;
  completed_at: string | null;
}

export interface GeneratedDocumentRow {
  id: string;
  job_id: string;
  project_id: string;
  template_key: string;
  template_version: number;
  file_name: string;
  storage_path: string;
  mime_type?: string;
  size_bytes: number;
  sha256: string;
  page_count: number;
  project_revision: number;
  warnings: GenerationWarning[];
  created_at: string;
}

export interface ProjectQuery {
  search?: string;
  status?: 'active' | 'archived' | 'all';
  sort?: 'updated' | 'created' | 'project_id';
  page?: number;
  pageSize?: number;
}

export interface DashboardStats {
  projects: number;
  documents: number;
  documentsLast30Days: number;
}

export const MIME = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
} as const;

export interface NewDocument {
  mime_type: string;
  job_id: string;
  project_id: string;
  template_key: string;
  template_version: number;
  file_name: string;
  storage_path: string;
  size_bytes: number;
  sha256: string;
  page_count: number;
  project_revision: number;
  warnings: GenerationWarning[];
}

/** Everything the UI needs from the backend. */
export interface DataApi {
  isAppUser(): Promise<boolean>;
  listProjects(q: ProjectQuery): Promise<{ rows: Project[]; total: number }>;
  getProject(id: string): Promise<Project>;
  createProject(fields: ProjectFields): Promise<Project>;
  updateProject(id: string, fields: ProjectFields, expectedRevision: number): Promise<Project>;
  setProjectStatus(id: string, status: 'active' | 'archived'): Promise<void>;
  stats(): Promise<DashboardStats>;
  createJob(projectId: string, revision: number, templates: string[], snapshot: ProjectFields): Promise<GenerationJob>;
  finishJob(id: string, status: GenerationJob['status'], warnings: unknown[], errors: unknown[]): Promise<void>;
  uploadDocument(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  recordDocument(doc: NewDocument): Promise<GeneratedDocumentRow>;
  listDocuments(projectId: string): Promise<GeneratedDocumentRow[]>;
  listJobs(projectId: string): Promise<GenerationJob[]>;
  recentDocuments(limit: number): Promise<(GeneratedDocumentRow & { project?: Pick<Project, 'project_id' | 'owner_name_en' | 'owner_name_ar'> })[]>;
  downloadDocument(path: string): Promise<Blob>;
  signedDocumentUrl(path: string, seconds: number): Promise<string>;
  uploadPhoto(path: string, file: Blob): Promise<void>;
  downloadPhoto(path: string): Promise<Blob>;
  deletePhoto(path: string): Promise<void>;
  /** Company stamp + signature PNG (private bucket); null when none has been uploaded yet. */
  getStampSignature(): Promise<Blob | null>;
  saveStampSignature(png: Blob): Promise<void>;
  deleteStampSignature(): Promise<void>;
}

export const STAMP_PATH = 'stamp-signature.png';

export class ConflictError extends Error {}

/** Map backend errors to safe, generic messages (no internals leaked to the UI). */
function fail(context: string, error: { message?: string; code?: string } | null): never {
  console.error(context, error);
  if (error?.code === '42501' || /row-level security|permission/i.test(error?.message ?? '')) {
    throw new Error('You are not authorized to perform this action.');
  }
  throw new Error(`${context} failed. Please try again.`);
}

const PROJECT_COLUMNS = 'id, fields, status, revision, created_at, updated_at, project_id, owner_name_ar, owner_name_en, plot_number';

export class SupabaseApi implements DataApi {
  private get db() {
    return supabase();
  }

  async isAppUser() {
    const { data, error } = await this.db.rpc('is_app_user');
    if (error) return false;
    return data === true;
  }

  async listProjects(q: ProjectQuery) {
    const pageSize = q.pageSize ?? 20;
    const page = q.page ?? 0;
    let query = this.db.from('projects').select(PROJECT_COLUMNS, { count: 'exact' });
    if (q.status && q.status !== 'all') query = query.eq('status', q.status);
    const term = q.search?.trim().toLowerCase();
    if (term) {
      // escape LIKE wildcards; PostgREST handles parameter quoting
      const safe = term.replace(/[\\%_]/g, (m) => `\\${m}`).replace(/[,()]/g, ' ');
      query = query.ilike('search_text', `%${safe}%`);
    }
    const order = q.sort === 'created' ? 'created_at' : q.sort === 'project_id' ? 'project_id' : 'updated_at';
    query = query.order(order, { ascending: q.sort === 'project_id', nullsFirst: false }).range(page * pageSize, page * pageSize + pageSize - 1);
    const { data, error, count } = await query;
    if (error) fail('Loading projects', error);
    return { rows: (data ?? []) as Project[], total: count ?? 0 };
  }

  async getProject(id: string) {
    const { data, error } = await this.db.from('projects').select(PROJECT_COLUMNS).eq('id', id).single();
    if (error) fail('Loading the project', error);
    return data as Project;
  }

  async createProject(fields: ProjectFields) {
    const { data, error } = await this.db.from('projects').insert({ fields }).select(PROJECT_COLUMNS).single();
    if (error) fail('Saving the project', error);
    return data as Project;
  }

  async updateProject(id: string, fields: ProjectFields, expectedRevision: number) {
    // optimistic concurrency: only update if nobody saved a newer revision meanwhile
    const { data, error } = await this.db
      .from('projects')
      .update({ fields })
      .eq('id', id)
      .eq('revision', expectedRevision)
      .select(PROJECT_COLUMNS);
    if (error) fail('Saving the project', error);
    if (!data || data.length === 0) throw new ConflictError('This project was changed elsewhere. Reload it before saving.');
    return data[0] as Project;
  }

  async setProjectStatus(id: string, status: 'active' | 'archived') {
    const { error } = await this.db.from('projects').update({ status }).eq('id', id);
    if (error) fail('Updating the project', error);
  }

  async stats() {
    const since = new Date(Date.now() - 30 * 86400_000).toISOString();
    const [p, d, r] = await Promise.all([
      this.db.from('projects').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      this.db.from('generated_documents').select('id', { count: 'exact', head: true }),
      this.db.from('generated_documents').select('id', { count: 'exact', head: true }).gte('created_at', since),
    ]);
    for (const x of [p, d, r]) if (x.error) fail('Loading statistics', x.error);
    return { projects: p.count ?? 0, documents: d.count ?? 0, documentsLast30Days: r.count ?? 0 };
  }

  async createJob(projectId: string, revision: number, templates: string[], snapshot: ProjectFields) {
    const { data, error } = await this.db
      .from('generation_jobs')
      .insert({ project_id: projectId, project_revision: revision, requested_templates: templates, snapshot })
      .select('*')
      .single();
    if (error) fail('Starting the generation', error);
    return data as GenerationJob;
  }

  async finishJob(id: string, status: GenerationJob['status'], warnings: unknown[], errors: unknown[]) {
    const { error } = await this.db.from('generation_jobs').update({ status, warnings, errors }).eq('id', id);
    if (error) fail('Finishing the generation', error);
  }

  async uploadDocument(path: string, bytes: Uint8Array, contentType: string) {
    const { error } = await this.db.storage
      .from('generated-documents')
      .upload(path, new Blob([bytes as BlobPart], { type: contentType }), { contentType, upsert: false });
    if (error) fail('Uploading the document', error);
  }

  async recordDocument(doc: NewDocument) {
    const { data, error } = await this.db.from('generated_documents').insert(doc).select('*').single();
    if (error) fail('Saving the document record', error);
    return data as GeneratedDocumentRow;
  }

  async listDocuments(projectId: string) {
    const { data, error } = await this.db
      .from('generated_documents')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) fail('Loading the history', error);
    return (data ?? []) as GeneratedDocumentRow[];
  }

  async listJobs(projectId: string) {
    const { data, error } = await this.db
      .from('generation_jobs')
      .select('id, project_id, project_revision, requested_templates, status, warnings, errors, created_at, completed_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) fail('Loading the history', error);
    return (data ?? []) as GenerationJob[];
  }

  async recentDocuments(limit: number) {
    const { data, error } = await this.db
      .from('generated_documents')
      .select('*, project:projects(project_id, owner_name_en, owner_name_ar)')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) fail('Loading recent documents', error);
    return (data ?? []) as (GeneratedDocumentRow & { project?: Pick<Project, 'project_id' | 'owner_name_en' | 'owner_name_ar'> })[];
  }

  async downloadDocument(path: string) {
    const { data, error } = await this.db.storage.from('generated-documents').download(path);
    if (error || !data) fail('Downloading the document', error);
    return data;
  }

  async signedDocumentUrl(path: string, seconds: number) {
    const { data, error } = await this.db.storage.from('generated-documents').createSignedUrl(path, seconds, { download: true });
    if (error || !data) fail('Preparing the download', error);
    return data.signedUrl;
  }

  async uploadPhoto(path: string, file: Blob) {
    const { error } = await this.db.storage.from('project-files').upload(path, file, { contentType: file.type, upsert: false });
    if (error) fail('Uploading the photo', error);
  }

  async getStampSignature() {
    const { data, error } = await this.db.storage.from('company-assets').download(STAMP_PATH);
    if (error) {
      if (/not.?found|does not exist/i.test(error.message ?? '')) return null;
      fail('Loading the stamp and signature', error);
    }
    return data;
  }
  async saveStampSignature(png: Blob) {
    const { error } = await this.db.storage.from('company-assets').upload(STAMP_PATH, png, { contentType: 'image/png', upsert: true, cacheControl: '0' });
    if (error) fail('Saving the stamp and signature', error);
  }
  async deleteStampSignature() {
    const { error } = await this.db.storage.from('company-assets').remove([STAMP_PATH]);
    if (error) fail('Removing the stamp and signature', error);
  }
  async downloadPhoto(path: string) {
    const { data, error } = await this.db.storage.from('project-files').download(path);
    if (error || !data) fail('Loading a photo', error);
    return data;
  }

  async deletePhoto(path: string) {
    const { error } = await this.db.storage.from('project-files').remove([path]);
    if (error) fail('Removing the photo', error);
  }
}
