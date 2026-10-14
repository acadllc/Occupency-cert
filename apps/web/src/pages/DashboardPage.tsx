import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Empty, Spinner, useToast } from '../components/ui';
import type { DashboardStats, GeneratedDocumentRow, Project } from '../lib/api';
import { catalog } from '../lib/config';
import { formatDateTime } from '../lib/files';
import { useApi } from '../lib/session';

type Recent = GeneratedDocumentRow & { project?: Pick<Project, 'project_id' | 'owner_name_en' | 'owner_name_ar'> };

export const templateName = (key: string) => catalog.templates.find((t) => t.definition.key === key)?.definition.name ?? key;

export default function DashboardPage() {
  const api = useApi();
  const toast = useToast();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [recent, setRecent] = useState<Recent[] | null>(null);

  useEffect(() => {
    Promise.all([api.stats(), api.listProjects({ pageSize: 6, sort: 'updated', status: 'active' }), api.recentDocuments(8)])
      .then(([s, p, r]) => {
        setStats(s);
        setProjects(p.rows);
        setRecent(r);
      })
      .catch((e: Error) => toast(e.message, 'error'));
  }, [api, toast]);

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p>Projects, generated documents and quick actions.</p>
        </div>
        <div className="btn-row">
          <Link className="btn" to="/projects">
            Find project
          </Link>
          <Link className="btn btn-primary" to="/projects/new">
            ＋ New project
          </Link>
        </div>
      </div>
      <div className="grid-stats">
        <div className="card stat">
          <div className="label">Active projects</div>
          <div className="value">{stats ? stats.projects : '–'}</div>
        </div>
        <div className="card stat">
          <div className="label">Documents generated</div>
          <div className="value">{stats ? stats.documents : '–'}</div>
        </div>
        <div className="card stat">
          <div className="label">Last 30 days</div>
          <div className="value">{stats ? stats.documentsLast30Days : '–'}</div>
        </div>
        <div className="card stat">
          <div className="label">Available templates</div>
          <div className="value">{catalog.templates.length}</div>
        </div>
      </div>
      <div className="two-col">
        <section className="card">
          <div className="card-head">
            <h2>Recently updated projects</h2>
            <Link to="/projects" className="small">
              View all
            </Link>
          </div>
          {!projects ? (
            <div className="card-pad">
              <Spinner />
            </div>
          ) : projects.length === 0 ? (
            <Empty title="No projects yet">
              <p>
                <Link to="/projects/new">Create the first project</Link> to start generating documents.
              </p>
            </Empty>
          ) : (
            <ul className="list">
              {projects.map((p) => (
                <li key={p.id}>
                  <div style={{ minWidth: 0 }}>
                    <Link to={`/projects/${p.id}`}>
                      <strong>{p.project_id || 'No project ID'}</strong>
                    </Link>
                    <div className="cell-sub">
                      {p.owner_name_en || '—'} · <span dir="rtl">{p.owner_name_ar || '—'}</span>
                    </div>
                  </div>
                  <span className="cell-sub">{formatDateTime(p.updated_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
          <div className="card-head">
            <h2>Recent generations</h2>
          </div>
          {!recent ? (
            <div className="card-pad">
              <Spinner />
            </div>
          ) : recent.length === 0 ? (
            <Empty title="Nothing generated yet" />
          ) : (
            <ul className="list">
              {recent.map((d) => (
                <li key={d.id}>
                  <div style={{ minWidth: 0 }}>
                    <div>{templateName(d.template_key)}</div>
                    <div className="cell-sub">
                      <Link to={`/projects/${d.project_id}`}>{d.project?.project_id || 'Project'}</Link> · revision {d.project_revision}
                    </div>
                  </div>
                  <span className="cell-sub">{formatDateTime(d.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
