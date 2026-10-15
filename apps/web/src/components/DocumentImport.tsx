import { useRef, useState } from 'react';
import { getField, isEmptyValue, mergeImports, type DocumentImport as ParsedDocument, type ExtractedValue, type FieldValue, type ProjectFields } from '@acad/engine';
import { company, registry } from '../lib/config';
import { Modal, useToast } from './ui';

function display(field: string, value: FieldValue | undefined): string {
  if (isEmptyValue(value)) return '';
  if (field === 'city') {
    const c = company.cities.find((x) => x.value === value);
    return c ? `${c.en} / ${c.ar}` : String(value);
  }
  return String(value);
}

interface Review {
  files: { name: string; result: ParsedDocument | null; error?: string }[];
  values: ExtractedValue[];
  notes: string[];
}

/**
 * "Fill from documents": reads site plans, Emirates IDs, passports, كفالة papers
 * and other PDFs in the browser (nothing is uploaded), shows what was found and
 * fills the chosen fields.
 */
export function DocumentImport({ fields, onApply, prominent }: { fields: ProjectFields; onApply: (values: ProjectFields) => void; prominent: boolean }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [chosen, setChosen] = useState<Record<string, boolean>>({});

  const onFiles = async (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    setBusy(true);
    try {
      const { readDocument } = await import('../lib/documentImport');
      const read: Review['files'] = [];
      for (const file of files) {
        if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
          read.push({ name: file.name, result: null, error: 'Not a PDF — photos and scans cannot be read; please type these details.' });
          continue;
        }
        try {
          read.push({ name: file.name, result: await readDocument(file) });
        } catch (e) {
          read.push({ name: file.name, result: null, error: (e as Error).message || 'Could not read this PDF.' });
        }
      }
      const ok = read.filter((f) => f.result) as { name: string; result: ParsedDocument }[];
      const merged = mergeImports(ok.map((f) => ({ file: f.name, result: f.result })));
      if (!merged.values.length) {
        toast('No project details were found in these files. Please fill in the fields manually.', 'error');
        if (!read.length) return;
      }
      // pre-select empty fields (and untouched defaults); values that would replace typed data stay unticked
      const pick: Record<string, boolean> = {};
      for (const v of merged.values) {
        const current = fields[v.field];
        pick[v.field] = isEmptyValue(current) || current === v.value || (!fields.project_id && current === getField(registry, v.field)?.default);
      }
      setChosen(pick);
      setReview({ files: read, values: merged.values, notes: merged.notes });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const apply = () => {
    if (!review) return;
    const values: ProjectFields = {};
    for (const v of review.values) if (chosen[v.field]) values[v.field] = v.value;
    onApply(values);
    const n = Object.keys(values).length;
    toast(`${n} field${n === 1 ? '' : 's'} filled from the documents — review them and add the remaining details.`, 'ok');
    setReview(null);
  };

  const picker = (
    <>
      <input ref={input} type="file" multiple accept="application/pdf,.pdf" className="sr-only" aria-label="Documents to read" onChange={(e) => void onFiles(e.target.files)} />
      <button className={`btn ${prominent ? 'btn-accent' : 'btn-sm'}`} disabled={busy} onClick={() => input.current?.click()}>
        {busy ? 'Reading…' : prominent ? 'Upload documents (PDF)' : 'Fill from documents'}
      </button>
    </>
  );

  return (
    <>
      {prominent ? (
        <section className="card card-pad siteplan-start">
          <div>
            <h2 style={{ margin: 0 }}>
              Start from documents <span className="muted" dir="rtl" lang="ar">· ابدأ من المستندات</span>
            </h2>
            <p className="small muted" style={{ margin: '4px 0 0' }}>
              Upload the site plan (مخطط أرض), Emirates IDs, passports, كفالة papers or other PDFs — you can select several files at once. Location,
              plot, land use, owners (all of them, from every page), ID numbers, phone and email are filled in for you. The files are read on this
              device only and are not uploaded.
            </p>
          </div>
          {picker}
        </section>
      ) : (
        picker
      )}

      {review && (
        <Modal
          title="Details found in the documents"
          onClose={() => setReview(null)}
          wide
          footer={
            <>
              <button className="btn" onClick={() => setReview(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" disabled={!Object.values(chosen).some(Boolean)} onClick={apply}>
                Fill selected fields
              </button>
            </>
          }
        >
          <ul className="doc-list">
            {review.files.map((f) => (
              <li key={f.name}>
                <span className="mono">{f.name}</span>{' '}
                {f.result ? <span className="badge">{f.result.label}</span> : <span className="badge badge-danger">not read</span>}
                {f.error && <div className="cell-sub">{f.error}</div>}
              </li>
            ))}
          </ul>
          {review.notes.map((n) => (
            <div className="alert alert-info" key={n}>
              {n}
            </div>
          ))}
          {review.values.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 36 }} />
                    <th>Field</th>
                    <th>Found</th>
                    <th>Current value</th>
                  </tr>
                </thead>
                <tbody>
                  {review.values.map((v) => {
                    const def = getField(registry, v.field);
                    const current = display(v.field, fields[v.field]);
                    const next = display(v.field, v.value);
                    const replaces = Boolean(current) && current !== next;
                    const dir = def?.dir === 'rtl' ? 'rtl' : undefined;
                    return (
                      <tr key={v.field}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Use ${def?.label ?? v.field}`}
                            checked={Boolean(chosen[v.field])}
                            onChange={(e) => setChosen({ ...chosen, [v.field]: e.target.checked })}
                          />
                        </td>
                        <td>
                          {def?.label ?? v.field}
                          <div className="cell-sub">{v.source}</div>
                        </td>
                        <td dir={dir}>
                          <strong>{next}</strong>
                        </td>
                        <td dir={dir} className={replaces ? '' : 'muted'}>
                          {current || '—'}
                          {replaces && chosen[v.field] && (
                            <div className="cell-sub" dir="ltr">
                              <span className="badge badge-warn">will be replaced</span>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="small muted" style={{ margin: 0 }}>
            Nothing is saved until you press Save. Fields that are not in the documents are left as they are.
          </p>
        </Modal>
      )}
    </>
  );
}
