-- ACAD Document Generator — initial schema, RLS and private storage.
-- Safe to run more than once (re-running repairs a partially applied run).
--
-- Access model
--   * Supabase Auth email/password; public sign-ups must be DISABLED in the dashboard.
--   * Being authenticated is NOT enough: the user id must also be listed in
--     public.app_users (allow-list). Today that is the single shared company
--     login; more individual accounts can be added later without schema changes.
--   * If the account has a verified MFA factor, an aal2 session is required.
--   * The browser only ever uses the publishable (anon) key; every table and
--     storage object is protected by the policies below.

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------- allow-list
create table if not exists public.app_users (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  label      text not null default 'ACAD shared company account',
  created_at timestamptz not null default now()
);
comment on table public.app_users is 'Auth users allowed to use the dashboard. Managed only from the SQL editor / service role.';
alter table public.app_users enable row level security;

drop policy if exists "app_users: read own membership" on public.app_users;
create policy "app_users: read own membership"
  on public.app_users for select to authenticated
  using (user_id = (select auth.uid()));

-- true when the caller is an allow-listed user with an adequate session
create or replace function public.is_app_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.app_users u where u.user_id = auth.uid())
     and (
       coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
       or not exists (
         select 1 from auth.mfa_factors f
         where f.user_id = auth.uid() and f.status = 'verified'
       )
     );
$$;
revoke all on function public.is_app_user() from public, anon;
grant execute on function public.is_app_user() to authenticated;

-- ---------------------------------------------------------------- projects
create table if not exists public.projects (
  id            uuid primary key default gen_random_uuid(),
  fields        jsonb not null default '{}'::jsonb check (jsonb_typeof(fields) = 'object'),
  status        text not null default 'active' check (status in ('active', 'archived')),
  revision      integer not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid default auth.uid() references auth.users (id) on delete set null,
  updated_by    uuid default auth.uid() references auth.users (id) on delete set null,
  -- searchable copies of common fields (exact strings preserved)
  project_id    text generated always as (fields ->> 'project_id') stored,
  owner_name_ar text generated always as (fields ->> 'owner_name_ar') stored,
  owner_name_en text generated always as (fields ->> 'owner_name_en') stored,
  plot_number   text generated always as (fields ->> 'plot_number') stored,
  search_text   text generated always as (
    lower(
      coalesce(fields ->> 'project_id', '') || ' ' ||
      coalesce(fields ->> 'owner_name_ar', '') || ' ' ||
      coalesce(fields ->> 'owner_name_en', '') || ' ' ||
      coalesce(fields ->> 'plot_number', '') || ' ' ||
      coalesce(fields ->> 'area_ar', '') || ' ' ||
      coalesce(fields ->> 'area_en', '') || ' ' ||
      coalesce(fields ->> 'sector_ar', '') || ' ' ||
      coalesce(fields ->> 'sector_en', '') || ' ' ||
      coalesce(fields ->> 'reference_number', '')
    )
  ) stored,
  constraint projects_fields_size check (pg_column_size(fields) < 200000)
);
create index if not exists projects_updated_at_idx on public.projects (updated_at desc);
create index if not exists projects_project_id_idx on public.projects (project_id);
-- pg_trgm may live in "extensions" (new projects) or "public" (older projects)
do $$
declare s text;
begin
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  execute format('create index if not exists projects_search_trgm_idx on public.projects using gin (search_text %I.gin_trgm_ops)', s);
end $$;
alter table public.projects enable row level security;

drop policy if exists "projects: select" on public.projects;
create policy "projects: select" on public.projects for select to authenticated using ((select public.is_app_user()));
drop policy if exists "projects: insert" on public.projects;
create policy "projects: insert" on public.projects for insert to authenticated with check ((select public.is_app_user()));
drop policy if exists "projects: update" on public.projects;
create policy "projects: update" on public.projects for update to authenticated
  using ((select public.is_app_user())) with check ((select public.is_app_user()));
-- no delete policy: projects are archived (status = 'archived'), never hard-deleted from the browser

-- immutable snapshots of every saved version
create table if not exists public.project_revisions (
  id         bigint generated always as identity primary key,
  project_id uuid not null references public.projects (id) on delete cascade,
  revision   integer not null,
  fields     jsonb not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  unique (project_id, revision)
);
alter table public.project_revisions enable row level security;
drop policy if exists "project_revisions: select" on public.project_revisions;
create policy "project_revisions: select" on public.project_revisions for select to authenticated using ((select public.is_app_user()));
-- rows are written only by the trigger below (security definer)

create or replace function public.projects_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.revision   := 1;
    new.created_at := now();
    new.updated_at := now();
    new.created_by := auth.uid();
    new.updated_by := auth.uid();
  else
    -- identity/audit columns cannot be rewritten by clients
    new.id         := old.id;
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.updated_at := now();
    new.updated_by := auth.uid();
    new.revision   := case when new.fields is distinct from old.fields then old.revision + 1 else old.revision end;
  end if;
  return new;
end;
$$;

create or replace function public.projects_after_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.revision <> old.revision then
    insert into public.project_revisions (project_id, revision, fields, created_by)
    values (new.id, new.revision, new.fields, auth.uid());
  end if;
  return null;
end;
$$;
revoke all on function public.projects_after_write() from public, anon, authenticated;

drop trigger if exists projects_before_write on public.projects;
create trigger projects_before_write before insert or update on public.projects
  for each row execute function public.projects_before_write();
drop trigger if exists projects_after_write on public.projects;
create trigger projects_after_write after insert or update on public.projects
  for each row execute function public.projects_after_write();

-- ---------------------------------------------------------------- templates
create table if not exists public.template_registry (
  template_key     text primary key,
  name             text not null,
  name_ar          text,
  template_version integer not null,
  status           text not null check (status in ('draft', 'needs_review', 'verified', 'active', 'retired')),
  format           text not null check (format in ('pdf', 'docx')),
  source_sha256    text not null,
  base_sha256      text not null,
  page_count       integer not null,
  required_fields  jsonb not null default '[]'::jsonb,
  updated_at       timestamptz not null default now()
);
comment on table public.template_registry is 'Public-safe template metadata (no secrets). Seeded from templates/dist by scripts/gen-template-seed.mjs.';
alter table public.template_registry enable row level security;
drop policy if exists "template_registry: select" on public.template_registry;
create policy "template_registry: select" on public.template_registry for select to authenticated using ((select public.is_app_user()));

-- ---------------------------------------------------------------- generation history
create table if not exists public.generation_jobs (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.projects (id) on delete cascade,
  project_revision    integer not null,
  requested_templates text[] not null check (cardinality(requested_templates) between 1 and 100),
  status              text not null default 'running' check (status in ('running', 'completed', 'partial', 'failed')),
  snapshot            jsonb not null,
  warnings            jsonb not null default '[]'::jsonb,
  errors              jsonb not null default '[]'::jsonb,
  created_at          timestamptz not null default now(),
  completed_at        timestamptz,
  created_by          uuid default auth.uid() references auth.users (id) on delete set null
);
create index if not exists generation_jobs_project_idx on public.generation_jobs (project_id, created_at desc);
alter table public.generation_jobs enable row level security;
drop policy if exists "generation_jobs: select" on public.generation_jobs;
create policy "generation_jobs: select" on public.generation_jobs for select to authenticated using ((select public.is_app_user()));
drop policy if exists "generation_jobs: insert" on public.generation_jobs;
create policy "generation_jobs: insert" on public.generation_jobs for insert to authenticated with check ((select public.is_app_user()));
drop policy if exists "generation_jobs: update" on public.generation_jobs;
create policy "generation_jobs: update" on public.generation_jobs for update to authenticated
  using ((select public.is_app_user())) with check ((select public.is_app_user()));

create or replace function public.generation_jobs_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := auth.uid();
    new.completed_at := null;
    new.status := 'running';
  else
    -- only the outcome may change after creation
    new.id := old.id;
    new.project_id := old.project_id;
    new.project_revision := old.project_revision;
    new.requested_templates := old.requested_templates;
    new.snapshot := old.snapshot;
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    if old.status <> 'running' then
      raise exception 'generation job % is already finished', old.id;
    end if;
    if new.status <> 'running' then new.completed_at := now(); end if;
  end if;
  return new;
end;
$$;
drop trigger if exists generation_jobs_guard on public.generation_jobs;
create trigger generation_jobs_guard before insert or update on public.generation_jobs
  for each row execute function public.generation_jobs_guard();

create table if not exists public.generated_documents (
  id               uuid primary key default gen_random_uuid(),
  job_id           uuid not null references public.generation_jobs (id) on delete cascade,
  project_id       uuid not null references public.projects (id) on delete cascade,
  template_key     text not null,
  template_version integer not null,
  file_name        text not null check (file_name ~ '^[A-Za-z0-9._-]{1,180}$'),
  storage_path     text not null unique,
  mime_type        text not null default 'application/pdf' check (mime_type = 'application/pdf'),
  size_bytes       bigint not null check (size_bytes > 0 and size_bytes <= 20971520),
  sha256           text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  page_count       integer not null check (page_count > 0),
  project_revision integer not null,
  warnings         jsonb not null default '[]'::jsonb,
  created_at       timestamptz not null default now(),
  created_by       uuid default auth.uid() references auth.users (id) on delete set null,
  constraint generated_documents_path check (storage_path = 'projects/' || project_id::text || '/' || template_key || '/' || file_name)
);
create index if not exists generated_documents_project_idx on public.generated_documents (project_id, created_at desc);
alter table public.generated_documents enable row level security;
drop policy if exists "generated_documents: select" on public.generated_documents;
create policy "generated_documents: select" on public.generated_documents for select to authenticated using ((select public.is_app_user()));
drop policy if exists "generated_documents: insert" on public.generated_documents;
create policy "generated_documents: insert" on public.generated_documents for insert to authenticated
  with check (
    (select public.is_app_user())
    and exists (select 1 from public.generation_jobs j where j.id = job_id and j.project_id = generated_documents.project_id)
  );
-- no update/delete policies: generated files and their records are immutable

create or replace function public.generated_documents_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_at := now();
  new.created_by := auth.uid();
  return new;
end;
$$;
drop trigger if exists generated_documents_guard on public.generated_documents;
create trigger generated_documents_guard before insert on public.generated_documents
  for each row execute function public.generated_documents_guard();

-- ---------------------------------------------------------------- privileges (defence in depth)
revoke all on public.app_users, public.projects, public.project_revisions, public.template_registry,
  public.generation_jobs, public.generated_documents from anon;
-- Supabase grants ALL on new public tables to authenticated by default; narrow it
revoke all on public.app_users, public.projects, public.project_revisions, public.template_registry,
  public.generation_jobs, public.generated_documents from authenticated;
grant select on public.app_users, public.project_revisions, public.template_registry to authenticated;
grant select, insert, update on public.projects, public.generation_jobs to authenticated;
grant select, insert on public.generated_documents to authenticated;

-- ---------------------------------------------------------------- private storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('generated-documents', 'generated-documents', false, 20971520, array['application/pdf']),
  ('project-files', 'project-files', false, 10485760, array['image/jpeg', 'image/png'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- generated PDFs: read + create only (no overwrite, no delete) under projects/<project uuid>/...
drop policy if exists "generated-documents: read" on storage.objects;
create policy "generated-documents: read"
  on storage.objects for select to authenticated
  using (bucket_id = 'generated-documents' and (select public.is_app_user()));
drop policy if exists "generated-documents: create" on storage.objects;
create policy "generated-documents: create"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'generated-documents'
    and (select public.is_app_user())
    and (storage.foldername(name))[1] = 'projects'
    and exists (select 1 from public.projects p where p.id::text = (storage.foldername(name))[2])
  );

-- project photos: read, create and delete (photos can be replaced); never public
drop policy if exists "project-files: read" on storage.objects;
create policy "project-files: read"
  on storage.objects for select to authenticated
  using (bucket_id = 'project-files' and (select public.is_app_user()));
drop policy if exists "project-files: create" on storage.objects;
create policy "project-files: create"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'project-files'
    and (select public.is_app_user())
    and (storage.foldername(name))[1] = 'projects'
    and exists (select 1 from public.projects p where p.id::text = (storage.foldername(name))[2])
  );
drop policy if exists "project-files: delete" on storage.objects;
create policy "project-files: delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'project-files' and (select public.is_app_user()));
