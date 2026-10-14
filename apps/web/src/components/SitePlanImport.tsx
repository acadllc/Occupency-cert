import { useRef, useState } from 'react';
import { getField, isEmptyValue, type FieldValue, type ProjectFields, type SitePlanResult } from '@acad/engine';
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

/**
 * "Start from a site plan": reads an Abu Dhabi site plan PDF in the browser
 * (nothing is uploaded), shows what was found and fills the chosen fields.
 */
export function SitePlanImport({ fields, onApply, prominent }: { fields: ProjectFields; onApply: (values: ProjectFields) => void; prominent: boolean }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SitePlanResult | null>(null);
  const [chosen, setChosen] = useState<Record<string, boolean>>({});

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      toast('Please choose the site plan PDF.', 'error');
      return;
    }
    setBusy(true);
    try {
      const { readSitePlan } = await import('../lib/sitePlan');
      const res = await readSitePlan(file);
      if (!res.values.length) {
        toast('No project details were found in this file. Please fill in the fields manually.', 'error');
        return;
      }
      // pre-select empty fields (and untouched defaults); values that would replace typed data stay unticked
      const pick: Record<string, boolean> = {};
      for (const v of res.values) {
        const current = fields[v.field];
        pick[v.field] = isEmptyValue(current) || current === v.value || (!fields.project_id && current === getField(registry, v.field)?.default);
      }
      setChosen(pick);
      setResult(res);
    } catch (e) {
      toast((e as Error).message || 'Could not read this PDF.', 'error');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const apply = () => {
    if (!result) return;
    const values: ProjectFields = {};
    for (const v of result.values) if (chosen[v.field]) values[v.field] = v.value;
    onApply(values);
    const n = Object.keys(values).length;
    toast(`${n} field${n === 1 ? '' : 's'} filled from the site plan — review them and add the remaining details.`, 'ok');
    setResult(null);
  };

  const picker = (
    <>
      <input ref={input} type="file" accept="application/pdf,.pdf" className="sr-only" aria-label="Site plan PDF" onChange={(e) => void onFile(e.target.files?.[0])} />
      <button className={`btn ${prominent ? 'btn-accent' : 'btn-sm'}`} disabled={busy} onClick={() => input.current?.click()}>
        {busy ? 'Reading…' : prominent ? 'Upload site plan (PDF)' : 'Fill from site plan'}
      </button>
    </>
  );

  return (
    <>
      {prominent ? (
        <section className="card card-pad siteplan-start">
          <div>
            <h2 style={{ margin: 0 }}>
              Start from a site plan <span className="muted" dir="rtl" lang="ar">· ابدأ من مخطط الأرض</span>
            </h2>
            <p className="small muted" style={{ margin: '4px 0 0' }}>
              Upload the Land Site Plan PDF and the location, plot, land use and owner fields are filled in for you. The file is read on this device only
              and is not uploaded. You can then complete anything else manually.
            </p>
          </div>
          {picker}
        </section>
      ) : (
        picker
      )}

      {result && (
        <Modal
          title="Details found in the site plan"
          onClose={() => setResult(null)}
          wide
          footer={
            <>
              <button className="btn" onClick={() => setResult(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" disabled={!Object.values(chosen).some(Boolean)} onClick={apply}>
                Fill selected fields
              </button>
            </>
          }
        >
          {!result.recognised && <div className="alert alert-warn">This file does not look like a Land Site Plan. Check the values carefully.</div>}
          {result.notes.map((n) => (
            <div className="alert alert-info" key={n}>
              {n}
            </div>
          ))}
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 36 }} />
                  <th>Field</th>
                  <th>From the site plan</th>
                  <th>Current value</th>
                </tr>
              </thead>
              <tbody>
                {result.values.map((v) => {
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
          <p className="small muted" style={{ margin: 0 }}>
            Nothing is saved until you press Save. Fields that are not in the site plan (project number, contractor, dates…) are left as they are.
          </p>
        </Modal>
      )}
    </>
  );
}
