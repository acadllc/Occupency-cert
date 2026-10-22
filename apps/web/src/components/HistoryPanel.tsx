import { useEffect, useState } from 'react';
import { MIME, type GeneratedDocumentRow, type GenerationJob, type Project } from '../lib/api';
import { catalog } from '../lib/config';
import { downloadName, formatBytes, formatDateTime, safeSegment, saveBlob, zipFiles } from '../lib/files';
import { useApi } from '../lib/session';
import { Empty, Spinner, StatusBadge, useToast } from './ui';

const nameOf = (key: string) => catalog.templates.find((t) => t.definition.key === key)?.definition.name ?? key;
const isWord = (d: GeneratedDocumentRow) => d.mime_type === MIME.docx || d.file_name.endsWith('.docx');
/** downloaded under the original file's name (see downloadName) */
const fileNameOf = (d: GeneratedDocumentRow) => downloadName(catalog.templates.find((t) => t.definition.key === d.template_key)?.definition, d.file_name, isWord(d) ? 'docx' : 'pdf');

export function HistoryPanel({ project }: { project: Project }) {
  const api = useApi();
  const toast = useToast();
  const [jobs, setJobs] = useState<GenerationJob[] | null>(null);
  const [docs, setDocs] = useState<GeneratedDocumentRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.listJobs(project.id), api.listDocuments(project.id)])
      .then(([j, d]) => {
        setJobs(j);
        setDocs(d);
      })
      .catch((e: Error) => toast(e.message, 'error'));
  }, [api, project.id, toast]);

  const download = async (d: GeneratedDocumentRow) => {
    setBusy(d.id);
    try {
      saveBlob(await api.downloadDocument(d.storage_path), fileNameOf(d));
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const downloadJob = async (job: GenerationJob, items: GeneratedDocumentRow[]) => {
    setBusy(job.id);
    try {
      const files = await Promise.all(items.map(async (d) => ({ name: fileNameOf(d), data: await api.downloadDocument(d.storage_path) })));
      saveBlob(await zipFiles(files), `${safeSegment(String(project.fields.project_id ?? ''), 'project')}_${job.created_at.slice(0, 10)}_r${job.project_revision}.zip`);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  if (!jobs) return <Spinner label="Loading history…" />;
  if (!jobs.length) return <div className="card"><Empty title="No documents generated yet">Select documents on the Details tab and generate them.</Empty></div>;

  return (
    <div className="stack">
      <p className="muted small" style={{ margin: 0 }}>
        Every generation is stored as an immutable, private file (PDF or Word) linked to the project revision it was made from. Editing the project never changes older
        files.
      </p>
      {jobs.map((job) => {
        const items = docs.filter((d) => d.job_id === job.id);
        return (
          <section className="card" key={job.id}>
            <div className="card-head">
              <div>
                <h3>
                  {formatDateTime(job.created_at)} · revision {job.project_revision}
                </h3>
                <p>
                  {items.length} of {job.requested_templates.length} documents <StatusBadge status={job.status} />
                </p>
              </div>
              {items.length > 1 && (
                <button className="btn btn-sm" disabled={busy === job.id} onClick={() => void downloadJob(job, items)}>
                  {busy === job.id ? 'Preparing…' : 'Download ZIP'}
                </button>
              )}
            </div>
            <ul className="list">
              {items.map((d) => (
                <li key={d.id}>
                  <div style={{ minWidth: 0 }}>
                    <div>{nameOf(d.template_key)}</div>
                    <div className="cell-sub">
                      <span className="badge badge-muted">{isWord(d) ? 'Word' : 'PDF'}</span> v{d.template_version} · {!isWord(d) && `${d.page_count} p · `}
                      {formatBytes(d.size_bytes)} · <span className="mono">{d.file_name}</span>
                    </div>
                    {d.warnings?.length > 0 && <div className="cell-sub">⚠ {d.warnings.map((w) => w.message).join(' · ')}</div>}
                  </div>
                  <button className="btn btn-sm" disabled={busy === d.id} onClick={() => void download(d)}>
                    Download
                  </button>
                </li>
              ))}
              {(job.errors as { template: string; error: string }[]).map((e, i) => (
                <li key={`e${i}`}>
                  <div>
                    <div>{nameOf(e.template)}</div>
                    <div className="cell-sub" style={{ color: 'var(--danger)' }}>
                      Failed: {e.error}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
