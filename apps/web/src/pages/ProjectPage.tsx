import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router-dom';
import {
  analyzeMissing,
  defaultFields,
  getField,
  isEmptyValue,
  isGeneratable,
  resolveValue,
  templateFieldKeys,
  templateSpecificFields,
  validateFields,
  type FieldDef,
  type FieldValue,
  type PhotoEntry,
  type ProjectFields,
} from '@acad/engine';
import { FieldInput } from '../components/FieldInput';
import { GenerateDialog } from '../components/GenerateDialog';
import { HistoryPanel } from '../components/HistoryPanel';
import { PhotosField } from '../components/PhotosField';
import { TemplatePicker } from '../components/TemplatePicker';
import { Confirm, Spinner, StatusBadge, useToast } from '../components/ui';
import { ConflictError, type Project } from '../lib/api';
import { catalog, company, registry } from '../lib/config';
import { formatDateTime } from '../lib/files';
import { useApi } from '../lib/session';

const SELECTED = 'selected_templates';

function selectedOf(fields: ProjectFields): string[] {
  const v = fields[SELECTED];
  return Array.isArray(v) ? (v as string[]).filter((k) => catalog.templates.some((t) => t.definition.key === k)) : [];
}

/** Render shared fields of a group, putting EN/AR pairs side by side (English left, Arabic right). */
function groupRows(defs: FieldDef[]): (FieldDef | [FieldDef, FieldDef])[] {
  const rows: (FieldDef | [FieldDef, FieldDef])[] = [];
  const done = new Set<string>();
  for (const d of defs) {
    if (done.has(d.key)) continue;
    const mate = d.pair ? defs.find((x) => x.key === d.pair) : undefined;
    if (mate && !done.has(mate.key)) {
      const en = d.dir === 'rtl' ? mate : d;
      const ar = d.dir === 'rtl' ? d : mate;
      rows.push([en, ar]);
      done.add(d.key);
      done.add(mate.key);
    } else {
      rows.push(d);
      done.add(d.key);
    }
  }
  return rows;
}

export default function ProjectPage() {
  const { id } = useParams();
  const api = useApi();
  const toast = useToast();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [fields, setFields] = useState<ProjectFields>(() => (id ? {} : defaultFields(registry)));
  const [loading, setLoading] = useState(Boolean(id));
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<'details' | 'history'>('details');
  const [generate, setGenerate] = useState<string[] | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);

  useEffect(() => {
    if (!id) {
      setProject(null);
      setFields(defaultFields(registry));
      setDirty(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    api
      .getProject(id)
      .then((p) => {
        setProject(p);
        setFields(p.fields);
        setDirty(false);
      })
      .catch((e: Error) => toast(e.message, 'error'))
      .finally(() => setLoading(false));
  }, [api, id, toast]);

  // warn before leaving with unsaved changes (ref: the blocker must see saves synchronously)
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirtyRef.current && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty]);

  const set = useCallback((key: string, v: FieldValue) => {
    setFields((f) => ({ ...f, [key]: v }));
    setDirty(true);
  }, []);

  const selected = selectedOf(fields);
  const errors = useMemo(() => validateFields(registry, fields), [fields]);
  const usedBySelection = useMemo(() => {
    const keys = new Set<string>();
    for (const t of catalog.templates) if (selected.includes(t.definition.key)) templateFieldKeys(t, registry).forEach((k) => keys.add(k));
    return keys;
  }, [selected]);
  const docFields = templateSpecificFields(selected, registry);
  const missing = (key: string) => usedBySelection.has(key) && isEmptyValue(fields[key]) && !getField(registry, key)?.optional;

  const save = async (): Promise<Project | null> => {
    if (Object.keys(errors).length) {
      toast('Please correct the highlighted fields first.', 'error');
      return null;
    }
    setSaving(true);
    try {
      const clean: ProjectFields = {};
      for (const [k, v] of Object.entries(fields)) {
        if (typeof v === 'string') {
          const t = v.trim();
          if (t) clean[k] = t;
        } else if (Array.isArray(v) ? v.length : v != null) clean[k] = v;
      }
      const before = project;
      const saved = project ? await api.updateProject(project.id, clean, project.revision) : await api.createProject(clean);
      // delete photos that were removed from the project
      if (before) {
        const keep = new Set(registry.fields.filter((f) => f.type === 'photos').flatMap((f) => ((saved.fields[f.key] as PhotoEntry[] | undefined) ?? []).map((p) => p.path)));
        const old = registry.fields.filter((f) => f.type === 'photos').flatMap((f) => ((before.fields[f.key] as PhotoEntry[] | undefined) ?? []).map((p) => p.path));
        await Promise.all(old.filter((p) => !keep.has(p)).map((p) => api.deletePhoto(p).catch(() => undefined)));
      }
      setProject(saved);
      setFields(saved.fields);
      dirtyRef.current = false;
      setDirty(false);
      toast(project ? `Saved (revision ${saved.revision})` : 'Project created', 'ok');
      if (!project) navigate(`/projects/${saved.id}`, { replace: true });
      return saved;
    } catch (e) {
      toast(e instanceof ConflictError ? e.message : (e as Error).message, 'error');
      return null;
    } finally {
      setSaving(false);
    }
  };

  const startGeneration = async () => {
    if (!selected.length) {
      toast('Select at least one document.', 'error');
      return;
    }
    const p = dirty || !project ? await save() : project;
    if (p) setGenerate(selected);
  };

  if (loading) return <Spinner label="Loading project…" />;

  const ctx = { fields, registry, company };
  const sharedGroups = registry.groups.filter((g) => g.key !== 'document');
  const title = project ? (typeof fields.project_id === 'string' && fields.project_id) || 'Untitled project' : 'New project';
  const missingCount = analyzeMissing(selected, catalog, registry, fields).required.length;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <div className="small muted">
            <Link to="/projects">Projects</Link> / {project ? 'Edit' : 'New'}
          </div>
          <h1>{title}</h1>
          {project && (
            <p>
              Revision {project.revision} · updated {formatDateTime(project.updated_at)} <StatusBadge status={project.status} />
            </p>
          )}
        </div>
        <div className="btn-row">
          {project && (
            <button className="btn" onClick={() => setConfirmArchive(true)}>
              {project.status === 'archived' ? 'Restore' : 'Archive'}
            </button>
          )}
          <button className="btn btn-primary" onClick={() => void save()} disabled={saving || (!dirty && Boolean(project))}>
            {saving ? 'Saving…' : project ? 'Save changes' : 'Create project'}
          </button>
        </div>
      </div>

      {project && (
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'details'} className={`tab ${tab === 'details' ? 'active' : ''}`} onClick={() => setTab('details')}>
            Details &amp; documents
          </button>
          <button role="tab" aria-selected={tab === 'history'} className={`tab ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>
            Generated documents
          </button>
        </div>
      )}

      {tab === 'history' && project ? (
        <HistoryPanel key={historyKey} project={project} />
      ) : (
        <>
          {sharedGroups.map((g) => {
            const defs = registry.fields.filter((f) => f.scope === 'shared' && f.group === g.key);
            return (
              <section className="card" key={g.key}>
                <div className="card-head">
                  <h2>{g.label}</h2>
                  {g.key === 'parties' && <p>Names are never translated automatically — enter both languages as they should appear.</p>}
                </div>
                <div className="card-pad form-grid">
                  {groupRows(defs).map((row) =>
                    Array.isArray(row) ? (
                      <div className="pair" key={row[0].key}>
                        {row.map((d) => (
                          <FieldInput key={d.key} def={d} value={fields[d.key]} onChange={(v) => set(d.key, v)} missing={missing(d.key)} error={errors[d.key]} />
                        ))}
                      </div>
                    ) : (
                      <FieldInput key={row.key} def={row} value={fields[row.key]} onChange={(v) => set(row.key, v)} missing={missing(row.key)} error={errors[row.key]} />
                    ),
                  )}
                  {g.key === 'location' && (
                    <div className="pair">
                      <div className="derived">
                        <span className="k">Project location (English, derived)</span>
                        {resolveValue('@project_location_en', ctx) || <span className="muted">—</span>}
                      </div>
                      <div className="derived" dir="rtl">
                        <span className="k">موقع المشروع (مشتق)</span>
                        {resolveValue('@project_location_ar', ctx) || <span className="muted">—</span>}
                      </div>
                    </div>
                  )}
                </div>
              </section>
            );
          })}

          <TemplatePicker
            selected={selected}
            onChange={(keys) => set(SELECTED, keys)}
          />

          {docFields.length > 0 && (
            <section className="card">
              <div className="card-head">
                <div>
                  <h2>Document-specific details</h2>
                  <p>Only shown for the selected documents.</p>
                </div>
              </div>
              <div className="card-pad form-grid">
                {groupRows(docFields).map((row) => {
                  const render = (d: FieldDef) =>
                    d.type === 'photos' ? (
                      <PhotosField key={d.key} def={d} projectId={project?.id ?? null} value={(fields[d.key] as PhotoEntry[] | undefined) ?? []} onChange={(v) => set(d.key, v)} />
                    ) : (
                      <FieldInput key={d.key} def={d} value={fields[d.key]} onChange={(v) => set(d.key, v)} missing={missing(d.key)} error={errors[d.key]} />
                    );
                  return Array.isArray(row) ? (
                    <div className="pair" key={row[0].key}>
                      {row.map(render)}
                    </div>
                  ) : (
                    render(row)
                  );
                })}
              </div>
            </section>
          )}

          <div className="sticky-actions">
            <span className="muted small" style={{ marginRight: 'auto', alignSelf: 'center' }}>
              {selected.length} document{selected.length === 1 ? '' : 's'} selected
              {selected.length > 0 && missingCount > 0 && ` · ${missingCount} empty field${missingCount === 1 ? '' : 's'}`}
              {dirty && ' · unsaved changes'}
            </span>
            <button className="btn" onClick={() => void save()} disabled={saving || (!dirty && Boolean(project))}>
              {project ? 'Save' : 'Create project'}
            </button>
            <button className="btn btn-accent" onClick={() => void startGeneration()} disabled={saving || selected.length === 0}>
              {dirty || !project ? 'Save & generate PDFs' : 'Generate PDFs'}
            </button>
          </div>
        </>
      )}

      {generate && project && (
        <GenerateDialog
          project={project}
          templateKeys={generate.filter((k) => isGeneratable(catalog.templates.find((t) => t.definition.key === k)!))}
          onClose={(didRun) => {
            setGenerate(null);
            if (didRun) setHistoryKey((k) => k + 1);
          }}
        />
      )}
      {confirmArchive && project && (
        <Confirm
          title={project.status === 'archived' ? 'Restore project?' : 'Archive project?'}
          message={project.status === 'archived' ? 'The project will appear in the active list again.' : 'Archived projects are hidden from the active list. Nothing is deleted and documents stay available.'}
          confirmLabel={project.status === 'archived' ? 'Restore' : 'Archive'}
          onCancel={() => setConfirmArchive(false)}
          onConfirm={async () => {
            setConfirmArchive(false);
            const status = project.status === 'archived' ? 'active' : 'archived';
            try {
              await api.setProjectStatus(project.id, status);
              setProject({ ...project, status });
              toast(status === 'archived' ? 'Project archived' : 'Project restored', 'ok');
            } catch (e) {
              toast((e as Error).message, 'error');
            }
          }}
        />
      )}
      {blocker.state === 'blocked' && (
        <Confirm
          title="Discard unsaved changes?"
          message="You have changes that are not saved yet."
          confirmLabel="Discard"
          danger
          onCancel={() => blocker.reset?.()}
          onConfirm={() => blocker.proceed?.()}
        />
      )}
    </div>
  );
}
