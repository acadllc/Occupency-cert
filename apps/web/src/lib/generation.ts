import type { GenerationWarning, ProjectFields } from '@acad/engine';
import { MIME, type DataApi, type GeneratedDocumentRow, type Project } from './api';
import { catalog } from './config';
import { getEngine } from './engine';
import { documentFileName, sha256Hex, storagePath } from './files';

export type OutputFormat = 'pdf' | 'docx';

export interface GenerationOptions {
  format: OutputFormat;
  stamp: boolean;
}

export type ItemState =
  | { status: 'queued' }
  | { status: 'running' }
  | { status: 'done'; row: GeneratedDocumentRow; bytes: Uint8Array; format: OutputFormat; warnings: GenerationWarning[] }
  | { status: 'failed'; error: string };

export interface RunResult {
  jobId: string;
  status: 'completed' | 'partial' | 'failed';
}

/**
 * Generates the selected templates for a SAVED project revision, uploads each
 * file to the private bucket and records it (immutable history). Word output is
 * produced for Word-based templates; official PDF forms are always PDF.
 * Partial failures are reported per template; nothing is overwritten.
 */
export async function runGeneration(
  api: DataApi,
  project: Project,
  templateKeys: string[],
  options: GenerationOptions,
  onUpdate: (key: string, state: ItemState) => void,
): Promise<RunResult> {
  const snapshot: ProjectFields = project.fields;
  const job = await api.createJob(project.id, project.revision, templateKeys, snapshot);
  const engine = await getEngine();
  const warnings: unknown[] = [];
  const errors: unknown[] = [];
  let ok = 0;
  for (const key of templateKeys) {
    onUpdate(key, { status: 'running' });
    try {
      const entry = catalog.templates.find((t) => t.definition.key === key);
      if (!entry) throw new Error('Unknown template');
      const projectId = typeof snapshot.project_id === 'string' ? snapshot.project_id : '';
      const title = `${entry.definition.name}${projectId ? ` – ${projectId}` : ''}`;
      const wantWord = options.format === 'docx';
      const asWord = wantWord && engine.supportsDocx(key);
      const res = asWord
        ? await engine.generateDocx(key, snapshot, { title, stamp: options.stamp })
        : await engine.generate(key, snapshot, { title, stamp: options.stamp });
      const resWarnings: GenerationWarning[] = [...res.warnings];
      if (wantWord && !asWord) {
        resWarnings.push({ code: 'missing_value', message: 'This is an official PDF form, so it was generated as PDF (no Word version exists).' });
      }
      const ext: OutputFormat = asWord ? 'docx' : 'pdf';
      const fileName = documentFileName(projectId, key, project.revision, new Date(), ext);
      const path = storagePath(project.id, key, fileName);
      await api.uploadDocument(path, res.bytes, MIME[ext]);
      const row = await api.recordDocument({
        job_id: job.id,
        project_id: project.id,
        template_key: key,
        template_version: res.templateVersion,
        file_name: fileName,
        storage_path: path,
        mime_type: MIME[ext],
        size_bytes: res.bytes.length,
        sha256: await sha256Hex(res.bytes),
        page_count: res.pageCount,
        project_revision: project.revision,
        warnings: resWarnings,
      });
      if (resWarnings.length) warnings.push({ template: key, warnings: resWarnings.map((w) => w.message) });
      ok++;
      onUpdate(key, { status: 'done', row, bytes: res.bytes, format: ext, warnings: resWarnings });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Generation failed';
      errors.push({ template: key, error: message });
      onUpdate(key, { status: 'failed', error: message });
    }
  }
  const status = ok === templateKeys.length ? 'completed' : ok === 0 ? 'failed' : 'partial';
  await api.finishJob(job.id, status, warnings, errors).catch(() => undefined);
  return { jobId: job.id, status };
}
