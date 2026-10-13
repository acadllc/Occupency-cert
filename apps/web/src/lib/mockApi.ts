/**
 * In-browser stand-in for Supabase, used ONLY for automated end-to-end tests
 * and local demos (build flag VITE_DATA_MODE=mock). It is never bundled into
 * the production GitHub Pages build.
 */
import type { ProjectFields } from '@acad/engine';
import type { DataApi, GeneratedDocumentRow, GenerationJob, NewDocument, Project, ProjectQuery } from './api';
import { ConflictError } from './api';

interface Store {
  projects: Project[];
  jobs: GenerationJob[];
  docs: GeneratedDocumentRow[];
}

const KEY = 'acad-mock-store';
const files = new Map<string, Blob>();

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Store;
  } catch {
    /* ignore */
  }
  return { projects: [], jobs: [], docs: [] };
}

function searchable(f: ProjectFields) {
  return ['project_id', 'owner_name_ar', 'owner_name_en', 'plot_number', 'area_ar', 'area_en', 'sector_ar', 'sector_en', 'reference_number']
    .map((k) => (typeof f[k] === 'string' ? (f[k] as string) : ''))
    .join(' ')
    .toLowerCase();
}

function str(f: ProjectFields, k: string) {
  return typeof f[k] === 'string' ? (f[k] as string) : null;
}

export class MockApi implements DataApi {
  private s = load();
  private save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.s));
    } catch {
      /* quota: ignore in mock */
    }
  }
  private row(id: string, fields: ProjectFields, base?: Project): Project {
    const now = new Date().toISOString();
    return {
      id,
      fields,
      status: base?.status ?? 'active',
      revision: base ? base.revision + 1 : 1,
      created_at: base?.created_at ?? now,
      updated_at: now,
      project_id: str(fields, 'project_id'),
      owner_name_ar: str(fields, 'owner_name_ar'),
      owner_name_en: str(fields, 'owner_name_en'),
      plot_number: str(fields, 'plot_number'),
    };
  }

  async isAppUser() {
    return true;
  }
  async listProjects(q: ProjectQuery) {
    let rows = this.s.projects.slice();
    if (q.status && q.status !== 'all') rows = rows.filter((p) => p.status === q.status);
    const term = q.search?.trim().toLowerCase();
    if (term) rows = rows.filter((p) => searchable(p.fields).includes(term));
    rows.sort((a, b) =>
      q.sort === 'project_id' ? (a.project_id ?? '').localeCompare(b.project_id ?? '') : q.sort === 'created' ? b.created_at.localeCompare(a.created_at) : b.updated_at.localeCompare(a.updated_at),
    );
    const size = q.pageSize ?? 20;
    const page = q.page ?? 0;
    return { rows: rows.slice(page * size, page * size + size), total: rows.length };
  }
  async getProject(id: string) {
    const p = this.s.projects.find((x) => x.id === id);
    if (!p) throw new Error('Loading the project failed. Please try again.');
    return p;
  }
  async createProject(fields: ProjectFields) {
    const p = this.row(crypto.randomUUID(), fields);
    this.s.projects.push(p);
    this.save();
    return p;
  }
  async updateProject(id: string, fields: ProjectFields, expectedRevision: number) {
    const i = this.s.projects.findIndex((x) => x.id === id);
    const cur = this.s.projects[i];
    if (!cur || cur.revision !== expectedRevision) throw new ConflictError('This project was changed elsewhere. Reload it before saving.');
    const changed = JSON.stringify(cur.fields) !== JSON.stringify(fields);
    const next = changed ? this.row(id, fields, cur) : cur;
    this.s.projects[i] = next;
    this.save();
    return next;
  }
  async setProjectStatus(id: string, status: 'active' | 'archived') {
    const p = this.s.projects.find((x) => x.id === id);
    if (p) p.status = status;
    this.save();
  }
  async stats() {
    const since = Date.now() - 30 * 86400_000;
    return {
      projects: this.s.projects.filter((p) => p.status === 'active').length,
      documents: this.s.docs.length,
      documentsLast30Days: this.s.docs.filter((d) => Date.parse(d.created_at) >= since).length,
    };
  }
  async createJob(projectId: string, revision: number, templates: string[]) {
    const job: GenerationJob = {
      id: crypto.randomUUID(),
      project_id: projectId,
      project_revision: revision,
      requested_templates: templates,
      status: 'running',
      warnings: [],
      errors: [],
      created_at: new Date().toISOString(),
      completed_at: null,
    };
    this.s.jobs.push(job);
    this.save();
    return job;
  }
  async finishJob(id: string, status: GenerationJob['status'], warnings: unknown[], errors: unknown[]) {
    const j = this.s.jobs.find((x) => x.id === id);
    if (j) Object.assign(j, { status, warnings, errors, completed_at: new Date().toISOString() });
    this.save();
  }
  async uploadDocument(path: string, bytes: Uint8Array) {
    if (files.has(path)) throw new Error('Uploading the PDF failed. Please try again.');
    files.set(path, new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  }
  async recordDocument(doc: NewDocument) {
    const row: GeneratedDocumentRow = { ...doc, id: crypto.randomUUID(), created_at: new Date().toISOString() };
    this.s.docs.push(row);
    this.save();
    return row;
  }
  async listDocuments(projectId: string) {
    return this.s.docs.filter((d) => d.project_id === projectId).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async listJobs(projectId: string) {
    return this.s.jobs.filter((j) => j.project_id === projectId).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async recentDocuments(limit: number) {
    return this.s.docs
      .slice()
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit)
      .map((d) => {
        const p = this.s.projects.find((x) => x.id === d.project_id);
        return { ...d, project: p ? { project_id: p.project_id, owner_name_en: p.owner_name_en, owner_name_ar: p.owner_name_ar } : undefined };
      });
  }
  async downloadDocument(path: string) {
    const b = files.get(path);
    if (!b) throw new Error('Downloading the PDF failed. Please try again.');
    return b;
  }
  async signedDocumentUrl(path: string) {
    return URL.createObjectURL(await this.downloadDocument(path));
  }
  async uploadPhoto(path: string, file: Blob) {
    files.set(path, file);
  }
  async downloadPhoto(path: string) {
    const b = files.get(path);
    if (!b) throw new Error('Loading a photo failed. Please try again.');
    return b;
  }
  async deletePhoto(path: string) {
    files.delete(path);
  }
}
