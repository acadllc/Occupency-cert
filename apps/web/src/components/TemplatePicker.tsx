import { useMemo, useState } from 'react';
import { isGeneratable } from '@acad/engine';
import { catalog } from '../lib/config';
import { StatusBadge } from './ui';

export function TemplatePicker({ selected, onChange }: { selected: string[]; onChange: (keys: string[]) => void }) {
  const [q, setQ] = useState('');
  const available = catalog.templates.filter(isGeneratable);
  const filtered = available.filter(({ definition: d }) => !q || `${d.name} ${d.nameAr ?? ''} ${d.description ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  const categories = useMemo(() => [...new Set(available.map((t) => t.definition.category ?? 'Other'))], [available]);
  const allOn = available.every((t) => selected.includes(t.definition.key));
  const toggle = (key: string) => onChange(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]);

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Documents to generate</h2>
          <p>Only verified templates are listed. Document-specific inputs appear below for the selected documents.</p>
        </div>
        <div className="btn-row">
          <input className="input" style={{ width: 220 }} type="search" placeholder="Search documents…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search documents" />
          <button className="btn btn-sm" onClick={() => onChange(allOn ? [] : available.map((t) => t.definition.key))}>
            {allOn ? 'Clear all' : `Select all (${available.length})`}
          </button>
        </div>
      </div>
      {categories.map((cat) => {
        const items = filtered.filter((t) => (t.definition.category ?? 'Other') === cat);
        if (!items.length) return null;
        return (
          <div key={cat}>
            <div className="category-title">{cat}</div>
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
      })}
      {filtered.length === 0 && <p className="card-pad muted">No documents match “{q}”.</p>}
    </section>
  );
}
