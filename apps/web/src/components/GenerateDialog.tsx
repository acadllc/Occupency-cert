import { useMemo, useState } from 'react';
import { analyzeMissing } from '@acad/engine';
import { MIME, type Project } from '../lib/api';
import { catalog, registry } from '../lib/config';
import { formatBytes, saveBlob, zipFiles, safeSegment } from '../lib/files';
import { runGeneration, type ItemState, type OutputFormat } from '../lib/generation';
import { useApi } from '../lib/session';
import { Modal } from './ui';

const entryOf = (key: string) => catalog.templates.find((t) => t.definition.key === key);
const nameOf = (key: string) => entryOf(key)?.definition.name ?? key;
const PREF_KEY = 'acad-generation-prefs';

function loadPrefs(): { format: OutputFormat; stamp: boolean } {
  try {
    const p = JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}');
    return { format: p.format === 'docx' ? 'docx' : 'pdf', stamp: p.stamp !== false };
  } catch {
    return { format: 'pdf', stamp: true };
  }
}

export function GenerateDialog({ project, templateKeys, onClose }: { project: Project; templateKeys: string[]; onClose: (didRun: boolean) => void }) {
  const api = useApi();
  const missing = useMemo(() => analyzeMissing(templateKeys, catalog, registry, project.fields), [templateKeys, project.fields]);
  const [phase, setPhase] = useState<'options' | 'running' | 'done'>('options');
  const [prefs, setPrefs] = useState(loadPrefs);
  const [states, setStates] = useState<Record<string, ItemState>>(() => Object.fromEntries(templateKeys.map((k) => [k, { status: 'queued' } as ItemState])));
  const [summary, setSummary] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const pdfOnly = templateKeys.filter((k) => !entryOf(k)?.layout.docx);
  const withStamp = templateKeys.filter((k) => entryOf(k)?.definition.fields.some((f) => 'stamp' in f));

  const start = async () => {
    if (started) return;
    setStarted(true);
    setPhase('running');
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
    } catch {
      /* ignore */
    }
    try {
      const res = await runGeneration(api, project, templateKeys, prefs, (k, s) => setStates((prev) => ({ ...prev, [k]: s })));
      setSummary(res.status === 'completed' ? 'All documents were generated and saved privately.' : res.status === 'partial' ? 'Some documents failed — see below. The others were saved.' : 'Generation failed.');
    } catch (e) {
      setSummary((e as Error).message);
    }
    setPhase('done');
  };

  const done = Object.entries(states).filter(([, s]) => s.status === 'done') as [string, Extract<ItemState, { status: 'done' }>][];
  const zipName = `${safeSegment(String(project.fields.project_id ?? ''), 'project')}_documents_r${project.revision}.zip`;
  const hasMissing = missing.required.length > 0 || missing.optional.length > 0;

  return (
    <Modal
      title={phase === 'options' ? 'Generate documents' : 'Generating documents'}
      onClose={phase === 'running' ? undefined : () => onClose(started)}
      wide
      footer={
        phase === 'options' ? (
          <>
            <button className="btn" onClick={() => onClose(false)}>
              {hasMissing ? 'Go back and fill in' : 'Cancel'}
            </button>
            <button className="btn btn-accent" onClick={() => void start()}>
              {hasMissing ? 'Continue with blanks' : 'Generate'}
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
      {phase === 'options' ? (
        <>
          <div className="form-grid">
            <div className="field">
              <span className="label" id="fmt-label">
                File format
              </span>
              <div className="chips" role="radiogroup" aria-labelledby="fmt-label">
                <label className={`chip ${prefs.format === 'pdf' ? 'on' : ''}`}>
                  <input type="radio" name="fmt" checked={prefs.format === 'pdf'} onChange={() => setPrefs({ ...prefs, format: 'pdf' })} />
                  PDF
                </label>
                <label className={`chip ${prefs.format === 'docx' ? 'on' : ''}`}>
                  <input type="radio" name="fmt" checked={prefs.format === 'docx'} onChange={() => setPrefs({ ...prefs, format: 'docx' })} />
                  Word (.docx)
                </label>
              </div>
              {prefs.format === 'docx' && pdfOnly.length > 0 && (
                <span className="help">
                  {pdfOnly.length} official government form{pdfOnly.length > 1 ? 's are' : ' is'} only available as PDF and will be generated as PDF.
                </span>
              )}
            </div>
            <div className="field">
              <span className="label">Company stamp</span>
              <label className={`chip ${prefs.stamp ? 'on' : ''}`} style={{ alignSelf: 'flex-start' }}>
                <input type="checkbox" checked={prefs.stamp} onChange={(e) => setPrefs({ ...prefs, stamp: e.target.checked })} />
                Add the ACAD stamp
              </label>
              <span className="help">
                {withStamp.length} of {templateKeys.length} selected document{templateKeys.length > 1 ? 's have' : ' has'} a consultant stamp position. Signatures are never added.
              </span>
            </div>
          </div>
          {hasMissing ? (
            <>
              <div className="alert alert-warn">
                Some inputs used by the selected documents are empty. Empty values are left blank in the document (no placeholder text). You can continue or go
                back and complete them.
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
            </>
          ) : (
            <div className="alert alert-ok">All inputs used by the selected documents are filled in.</div>
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
                        <span className="badge badge-muted">{s.format === 'docx' ? 'Word' : 'PDF'}</span> {s.format === 'pdf' && `${s.row.page_count} page${s.row.page_count > 1 ? 's' : ''} · `}
                        {formatBytes(s.row.size_bytes)}
                        {s.warnings.length > 0 && <span className="badge badge-warn" style={{ marginLeft: 6 }}>{s.warnings.length} note{s.warnings.length > 1 ? 's' : ''}</span>}
                      </div>
                    )}
                    {s.status === 'done' && s.warnings.map((w, i) => <div key={i} className="cell-sub">⚠ {w.message}</div>)}
                    {s.status === 'failed' && <div className="cell-sub" style={{ color: 'var(--danger)' }}>{s.error}</div>}
                  </div>
                  {s.status === 'done' && (
                    <button className="btn btn-sm" onClick={() => saveBlob(new Blob([s.bytes as BlobPart], { type: MIME[s.format] }), s.row.file_name)}>
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
