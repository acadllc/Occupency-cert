import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Empty, Spinner, StatusBadge, useToast } from '../components/ui';
import type { Project, ProjectQuery } from '../lib/api';
import { company } from '../lib/config';
import { formatDateTime } from '../lib/files';
import { useApi } from '../lib/session';

const PAGE = 20;

export default function ProjectsPage() {
  const api = useApi();
  const toast = useToast();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState<ProjectQuery['status']>('active');
  const [sort, setSort] = useState<ProjectQuery['sort']>('updated');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ rows: Project[]; total: number } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setPage(0), [debounced, status, sort]);
  useEffect(() => {
    let live = true;
    setData(null);
    api
      .listProjects({ search: debounced, status, sort, page, pageSize: PAGE })
      .then((d) => live && setData(d))
      .catch((e: Error) => toast(e.message, 'error'));
    return () => {
      live = false;
    };
  }, [api, toast, debounced, status, sort, page]);

  const city = (p: Project) => company.cities.find((c) => c.value === p.fields.city)?.en ?? '';
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Projects</h1>
          <p>Search by project ID, owner (Arabic or English), plot number, area or sector.</p>
        </div>
        <Link className="btn btn-primary" to="/projects/new">
          ＋ New project
        </Link>
      </div>
      <section className="card">
        <div className="toolbar">
          <label className="sr-only" htmlFor="search">
            Search projects
          </label>
          <input id="search" className="input" type="search" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <label className="sr-only" htmlFor="status">
            Status
          </label>
          <select id="status" className="input" style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value as ProjectQuery['status'])}>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="all">All</option>
          </select>
          <label className="sr-only" htmlFor="sort">
            Sort
          </label>
          <select id="sort" className="input" style={{ width: 'auto' }} value={sort} onChange={(e) => setSort(e.target.value as ProjectQuery['sort'])}>
            <option value="updated">Recently updated</option>
            <option value="created">Recently created</option>
            <option value="project_id">Project ID</option>
          </select>
          <span className="muted small" style={{ marginLeft: 'auto' }}>
            {data ? `${data.total} project${data.total === 1 ? '' : 's'}` : ''}
          </span>
        </div>
        {!data ? (
          <div className="card-pad">
            <Spinner label="Loading projects…" />
          </div>
        ) : data.rows.length === 0 ? (
          <Empty title={debounced ? 'No matching projects' : 'No projects yet'}>{!debounced && <Link to="/projects/new">Create a project</Link>}</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Project ID</th>
                  <th>Owner</th>
                  <th>Location</th>
                  <th>Plot</th>
                  <th>Updated</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((p) => (
                  <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/projects/${p.id}`)}>
                    <td>
                      <Link to={`/projects/${p.id}`} onClick={(e) => e.stopPropagation()}>
                        <strong>{p.project_id || '—'}</strong>
                      </Link>
                      <div className="cell-sub">rev. {p.revision}</div>
                    </td>
                    <td>
                      <div>{p.owner_name_en || '—'}</div>
                      <div className="cell-sub" dir="rtl" style={{ textAlign: 'left' }}>
                        {p.owner_name_ar || ''}
                      </div>
                    </td>
                    <td>
                      {city(p)}
                      <div className="cell-sub">{String(p.fields.area_en ?? '')}</div>
                    </td>
                    <td className="mono">{p.plot_number || '—'}</td>
                    <td className="cell-sub">{formatDateTime(p.updated_at)}</td>
                    <td>
                      <StatusBadge status={p.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && pages > 1 && (
          <div className="toolbar" style={{ borderBottom: 0, justifyContent: 'flex-end' }}>
            <button className="btn btn-sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            <span className="small muted">
              Page {page + 1} of {pages}
            </span>
            <button className="btn btn-sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
