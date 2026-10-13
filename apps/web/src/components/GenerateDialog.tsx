import { useMemo, useState } from 'react';
import { analyzeMissing } from '@acad/engine';
import type { Project } from '../lib/api';
import { catalog, registry } from '../lib/config';
import { formatBytes, saveBlob, zipFiles, safeSegment } from '../lib/files';
import { runGeneration, type ItemState } from '../lib/generation';
import { useApi } from '../lib/session';
import { Modal } from './ui';

const nameOf = (key: string) => catalog.templates.find((t) => t.definition.key === key)?.definition.name ?? key;

export function GenerateDialog({ project, templateKeys, onClose }: { project: Project; templateKeys: string[]; onClose: (didRun: boolean) => void }) {
  const api = useApi();
  const missing = useMemo(() => analyzeMissing(templateKeys, catalog, registry, project.fields), [templateKeys, project.fields]);
  const [phase, setPhase] = useState<'preflight' | 'running' | 'done'>(missing.required.length || missing.optional.length ? 'preflight' : 'running');
  const [states, setStates] = useState<Record<string, ItemState>>(() => Object.fromEntries(templateKeys.map((k) => [k, { status: 'queued' } as ItemState])));
  const [summary, setSummary] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  const start = async () => {
    if (started) return;
    setStarted(true);
    setPhase('running');
    try {
      const res = await runGeneration(api, project, templateKeys, (k, s) => setStates((prev) => ({ ...prev, [k]: s })));
      setSummary(res.status === 'completed' ? 'All documents were generated and saved privately.' : res.status === 'partial' ? 'Some documents failed — see below. The others were saved.' : 'Generation failed.');
    } catch (e) {
      setSummary((e as Error).message);
    }
    setPhase('done');
  };
  if (phase === 'running' && !started) void start();

  const done = Object.entries(states).filter(([, s]) => s.status === 'done') as [string, Extract<ItemState, { status: 'done' }>][];
  const zipName = `${safeSegment(String(project.fields.project_id ?? ''), 'project')}_documents_r${project.revision}.zip`;

  return (
    <Modal
      title={phase === 'preflight' ? 'Check before generating' : 'Generating documents'}
      onClose={phase === 'running' ? undefined : () => onClose(started)}
      wide
      footer={
        phase === 'preflight' ? (
          <>
            <button className="btn" onClick={() => onClose(false)}>
              Go back and fill in
            </button>
            <button className="btn btn-accent" onClick={() => void start()}>
              Continue with blanks
            </button>
          </>
        ) : phase === 'done' ? (
          <>
            {done.length > 1 && (
              <button className="btn" onClick={async () => saveBlob(await zipFiles(done.map(([, s]) => ({ name: s.row.file_name, data: s.bytes }))), zipName)}>
                Download ZIP ({done.length})
              </button>
            )}
            <button className="btn btn-primary" onClick={() => onClose(true)}>
              Close
            </button>
          </>
        ) : null
      }
    >
      {phase === 'preflight' ? (
        <>
          <div className="alert alert-warn">
            Some inputs used by the selected documents are empty. Empty values are left blank in the PDF (no placeholder text). You can continue or go back
            and complete them.
          </div>
          {missing.required.length > 0 && (
            <div>
              <h3>Empty fields ({missing.required.length})</h3>
              <ul className="small">
                {missing.required.map((m) => (
                  <li key={m.field.key}>
                    <strong>{m.field.label}</strong> — used by {m.templates.map(nameOf).join(', ')}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {missing.optional.length > 0 && (
            <div>
              <h3 className="muted">Optional fields left empty ({missing.optional.length})</h3>
              <p className="small muted">{missing.optional.map((m) => m.field.label).join(', ')}</p>
            </div>
          )}
          <p className="small muted">Documents are generated from saved revision {project.revision}.</p>
        </>
      ) : (
        <>
          {summary && <div className={`alert ${done.length === templateKeys.length ? 'alert-ok' : 'alert-warn'}`}>{summary}</div>}
          <div>
            {templateKeys.map((k) => {
              const s = states[k];
              return (
                <div className="progress-item" key={k}>
                  <span style={{ width: 22 }}>{s.status === 'running' ? <span className="spinner" /> : s.status === 'done' ? '✅' : s.status === 'failed' ? '⚠️' : '•'}</span>
                  <div className="grow">
                    <div>{nameOf(k)}</div>
                    {s.status === 'done' && (
                      <div className="cell-sub">
                        {s.row.page_count} page{s.row.page_count > 1 ? 's' : ''} · {formatBytes(s.row.size_bytes)}
                        {s.warnings.length > 0 && <span className="badge badge-warn" style={{ marginLeft: 6 }}>{s.warnings.length} warning{s.warnings.length > 1 ? 's' : ''}</span>}
                      </div>
                    )}
                    {s.status === 'done' && s.warnings.map((w, i) => <div key={i} className="cell-sub">⚠ {w.message}</div>)}
                    {s.status === 'failed' && <div className="cell-sub" style={{ color: 'var(--danger)' }}>{s.error}</div>}
                  </div>
                  {s.status === 'done' && (
                    <button className="btn btn-sm" onClick={() => saveBlob(new Blob([s.bytes as BlobPart], { type: 'application/pdf' }), s.row.file_name)}>
                      Download
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </Modal>
  );
}
