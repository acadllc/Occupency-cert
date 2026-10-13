import { useState } from 'react';
import { getField, isGeneratable, templateFieldKeys } from '@acad/engine';
import { StatusBadge } from '../components/ui';
import { catalog, registry } from '../lib/config';

export default function TemplatesPage() {
  const [q, setQ] = useState('');
  const list = catalog.templates.filter(({ definition: d }) => !q || `${d.name} ${d.nameAr ?? ''} ${d.key}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Templates</h1>
          <p>Sanitized document templates, their versions and the inputs each one uses.</p>
        </div>
      </div>
      <section className="card">
        <div className="toolbar">
          <input className="input" type="search" placeholder="Filter templates…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter templates" />
          <span className="muted small" style={{ marginLeft: 'auto' }}>
            {catalog.templates.filter(isGeneratable).length} of {catalog.templates.length} available for generation
          </span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Template</th>
                <th>Source</th>
                <th>Pages</th>
                <th>Inputs used</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {list.map((entry) => {
                const d = entry.definition;
                const keys = templateFieldKeys(entry, registry);
                return (
                  <tr key={d.key}>
                    <td style={{ maxWidth: 360 }}>
                      <strong>{d.name}</strong>
                      <div className="cell-sub" dir="rtl" style={{ textAlign: 'left' }}>
                        {d.nameAr}
                      </div>
                      <div className="cell-sub">{d.description}</div>
                      {d.reviewNotes && <div className="cell-sub">Note: {d.reviewNotes}</div>}
                    </td>
                    <td className="cell-sub">
                      {d.format.toUpperCase()} · v{d.version}
                      <div className="mono" style={{ wordBreak: 'break-all' }}>
                        {entry.layout.baseSha256.slice(0, 12)}
                      </div>
                    </td>
                    <td>{entry.layout.pageCount}</td>
                    <td className="cell-sub" style={{ maxWidth: 320 }}>
                      {keys.map((k) => getField(registry, k)?.label ?? k).join(', ')}
                    </td>
                    <td>
                      <StatusBadge status={d.status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
