import type { GenerationWarning, ProjectFields } from '@acad/engine';
import type { DataApi, GeneratedDocumentRow, Project } from './api';
import { catalog } from './config';
import { getEngine } from './engine';
import { documentFileName, sha256Hex, storagePath } from './files';

export type ItemState =
  | { status: 'queued' }
  | { status: 'running' }
  | { status: 'done'; row: GeneratedDocumentRow; bytes: Uint8Array; warnings: GenerationWarning[] }
  | { status: 'failed'; error: string };

export interface RunResult {
  jobId: string;
  status: 'completed' | 'partial' | 'failed';
}

/**
 * Generates the selected templates for a SAVED project revision, uploads each
 * PDF to the private bucket and records it (immutable history). Partial
 * failures are reported per template; nothing is overwritten.
 */
export async function runGeneration(
  api: DataApi,
  project: Project,
  templateKeys: string[],
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
      const res = await engine.generate(key, snapshot, { title: `${entry.definition.name}${projectId ? ` – ${projectId}` : ''}` });
      const fileName = documentFileName(projectId, key, project.revision);
      const path = storagePath(project.id, key, fileName);
      await api.uploadDocument(path, res.bytes);
      const row = await api.recordDocument({
        job_id: job.id,
        project_id: project.id,
        template_key: key,
        template_version: res.templateVersion,
        file_name: fileName,
        storage_path: path,
        size_bytes: res.bytes.length,
        sha256: await sha256Hex(res.bytes),
        page_count: res.pageCount,
        project_revision: project.revision,
        warnings: res.warnings,
      });
      if (res.warnings.length) warnings.push({ template: key, warnings: res.warnings.map((w) => w.message) });
      ok++;
      onUpdate(key, { status: 'done', row, bytes: res.bytes, warnings: res.warnings });
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
