import { useMemo, useState } from 'react';
import { isGeneratable } from '@acad/engine';
import { catalog, projectTypeOf, projectTypes } from '../lib/config';
import { StatusBadge } from './ui';

const available = catalog.templates.filter(isGeneratable);

export function TemplatePicker({ selected, onChange }: { selected: string[]; onChange: (keys: string[]) => void }) {
  const [q, setQ] = useState('');
  // open the first tab that already has selected documents
  const [tab, setTab] = useState(() => projectTypeOf(available.find((t) => selected.includes(t.definition.key))?.definition ?? {}));
  const inTab = available.filter((t) => projectTypeOf(t.definition) === tab);
  const filtered = inTab.filter(({ definition: d }) => !q || `${d.name} ${d.nameAr ?? ''} ${d.description ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  const current = projectTypes.find((p) => p.key === tab);
  const categories = useMemo(() => {
    const order = current?.categories ?? [];
    const rank = (c: string) => (order.includes(c) ? order.indexOf(c) : order.length);
    return [...new Set(inTab.map((t) => t.definition.category ?? 'Other'))].sort((a, b) => rank(a) - rank(b));
  }, [inTab, current]);
  const toggle = (key: string) => onChange(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]);
  const setMany = (keys: string[], on: boolean) => onChange(on ? [...new Set([...selected, ...keys])] : selected.filter((k) => !keys.includes(k)));
  const tabKeys = inTab.map((t) => t.definition.key);
  const tabAllOn = tabKeys.length > 0 && tabKeys.every((k) => selected.includes(k));

  return (
    <section className="card">
      <div className="card-head picker-head">
        <div>
          <h2>Documents to generate</h2>
          <p>Choose the project type, then the documents. Document-specific inputs appear below for the selected documents.</p>
        </div>
        <div className="btn-row">
          <input className="input" style={{ width: 200 }} type="search" placeholder="Search documents…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search documents" />
          {tabKeys.length > 0 && (
            <button className="btn btn-sm" onClick={() => setMany(tabKeys, !tabAllOn)}>
              {tabAllOn ? 'Clear this tab' : `Select all in tab (${tabKeys.length})`}
            </button>
          )}
          {selected.length > 0 && (
            <button className="btn btn-sm btn-ghost" onClick={() => onChange([])}>
              Clear selection
            </button>
          )}
        </div>
      </div>
      <div className="tabs project-tabs" role="tablist" aria-label="Project type">
        {projectTypes.map((p) => {
          const keys = available.filter((t) => projectTypeOf(t.definition) === p.key).map((t) => t.definition.key);
          const count = keys.filter((k) => selected.includes(k)).length;
          return (
            <button key={p.key} role="tab" aria-selected={tab === p.key} className={`tab ${tab === p.key ? 'active' : ''}`} onClick={() => setTab(p.key)}>
              {p.en} <span dir="rtl" lang="ar" className="tab-ar">{p.ar}</span>
              {count > 0 ? <span className="badge">{count}</span> : keys.length === 0 ? <span className="badge badge-muted">soon</span> : null}
            </button>
          );
        })}
      </div>
      {inTab.length === 0 ? (
        <div className="empty">
          <strong>
            No {current?.en ?? ''} documents yet <span dir="rtl">({current?.ar})</span>
          </strong>
          <p className="small">Send the reference documents (Word or PDF) for this project type and they will be added here.</p>
        </div>
      ) : (
        categories.map((cat) => {
          const items = filtered.filter((t) => (t.definition.category ?? 'Other') === cat);
          if (!items.length) return null;
          const keys = items.map((t) => t.definition.key);
          const allOn = keys.every((k) => selected.includes(k));
          const someOn = !allOn && keys.some((k) => selected.includes(k));
          return (
            <div key={cat}>
              <label className="category-title category-select">
                <input
                  type="checkbox"
                  checked={allOn}
                  ref={(el) => {
                    if (el) el.indeterminate = someOn;
                  }}
                  onChange={() => setMany(keys, !allOn)}
                  aria-label={`Select all ${cat}`}
                />
                {cat} <span className="muted">({keys.filter((k) => selected.includes(k)).length}/{keys.length})</span>
              </label>
              <div className="tpl-grid">
                {items.map(({ definition: d, layout }) => {
                  const on = selected.includes(d.key);
                  return (
                    <label key={d.key} className={`tpl ${on ? 'on' : ''}`}>
                      <input type="checkbox" checked={on} onChange={() => toggle(d.key)} />
                      <span style={{ minWidth: 0 }}>
                        <span className="name">{d.name}</span>
                        <span className="name-ar" dir="rtl" style={{ display: 'block' }}>
                          {d.nameAr}
                        </span>
                        <span className="meta">
                          <span className="badge badge-muted">{d.format.toUpperCase()} source</span>
                          <span className="badge badge-muted">
                            {layout.pageCount} page{layout.pageCount > 1 ? 's' : ''}
                          </span>
                          <StatusBadge status={d.status} />
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })
      )}
      {inTab.length > 0 && filtered.length === 0 && <p className="card-pad muted">No documents match “{q}”.</p>}
    </section>
  );
}
