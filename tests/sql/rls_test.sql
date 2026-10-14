-- RLS / policy tests. Run with tests/sql/run.sh (fails on the first broken assertion).
\set ON_ERROR_STOP on
insert into auth.users values
  ('11111111-1111-1111-1111-111111111111', 'company@acad.ae'),
  ('22222222-2222-2222-2222-222222222222', 'stranger@example.com');
insert into public.app_users (user_id) values ('11111111-1111-1111-1111-111111111111');

create or replace function pg_temp.as_user(uid text, aal text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', aal)::text, false);
end $$;

-- 1. anonymous visitors get nothing
set role anon;
do $$ begin
  begin perform * from public.projects; raise exception 'anon could read projects';
  exception when insufficient_privilege then null; end;
  begin perform public.is_app_user(); raise exception 'anon could call is_app_user';
  exception when insufficient_privilege then null; end;
  if exists (select 1 from storage.objects) then raise exception 'anon sees storage objects'; end if;
end $$;
reset role;

-- 2. an authenticated user who is NOT on the allow-list is locked out
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
set role authenticated;
do $$ begin
  if public.is_app_user() then raise exception 'stranger is app user'; end if;
  begin insert into public.projects (fields) values ('{"project_id":"X"}'); raise exception 'stranger inserted project';
  exception when insufficient_privilege then null; end;
  begin insert into storage.objects (bucket_id, name) values ('generated-documents', 'projects/x/y.pdf'); raise exception 'stranger uploaded';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- 3. the company account works end to end
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
set role authenticated;
do $$
declare pid uuid; jid uuid; rev int; n int;
begin
  if not public.is_app_user() then raise exception 'company user rejected'; end if;
  insert into public.projects (fields, created_by) values ('{"project_id":"007-A","owner_name_ar":"سالم","plot_number":"047"}', '22222222-2222-2222-2222-222222222222')
    returning id into pid;
  if (select created_by from public.projects where id = pid) <> '11111111-1111-1111-1111-111111111111' then raise exception 'created_by spoofed'; end if;
  if (select project_id from public.projects where id = pid) <> '007-A' then raise exception 'generated column'; end if;
  update public.projects set fields = fields || '{"owner_name_en":"Salem"}' where id = pid;
  update public.projects set status = 'active' where id = pid; -- no field change: same revision
  select revision into rev from public.projects where id = pid;
  if rev <> 2 then raise exception 'revision % <> 2', rev; end if;
  select count(*) into n from public.project_revisions where project_id = pid;
  if n <> 2 then raise exception 'revisions % <> 2', n; end if;
  if not exists (select 1 from public.projects where search_text like '%salem%' and search_text like '%047%') then raise exception 'search_text'; end if;

  begin delete from public.projects where id = pid; raise exception 'project deleted';
  exception when insufficient_privilege then null; end;
  begin insert into public.project_revisions (project_id, revision, fields) values (pid, 99, '{}'); raise exception 'revision forged';
  exception when insufficient_privilege then null; end;

  insert into public.generation_jobs (project_id, project_revision, requested_templates, snapshot)
    values (pid, rev, array['number-of-users'], '{}') returning id into jid;
  -- wrong path is rejected
  begin
    insert into public.generated_documents (job_id, project_id, template_key, template_version, file_name, storage_path, size_bytes, sha256, page_count, project_revision)
    values (jid, pid, 'number-of-users', 1, 'a.pdf', 'projects/other/number-of-users/a.pdf', 10, repeat('a', 64), 1, rev);
    raise exception 'bad storage path accepted';
  exception when check_violation then null; end;
  insert into public.generated_documents (job_id, project_id, template_key, template_version, file_name, storage_path, size_bytes, sha256, page_count, project_revision)
    values (jid, pid, 'number-of-users', 1, '20261013-101500-r2.pdf', 'projects/' || pid || '/number-of-users/20261013-101500-r2.pdf', 1234, repeat('b', 64), 1, rev);
  insert into public.generated_documents (job_id, project_id, template_key, template_version, file_name, storage_path, mime_type, size_bytes, sha256, page_count, project_revision)
    values (jid, pid, 'number-of-users', 2, '20261013-101500-r2.docx', 'projects/' || pid || '/number-of-users/20261013-101500-r2.docx',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 4321, repeat('c', 64), 1, rev);
  begin
    insert into public.generated_documents (job_id, project_id, template_key, template_version, file_name, storage_path, mime_type, size_bytes, sha256, page_count, project_revision)
    values (jid, pid, 'number-of-users', 2, 'x.exe', 'projects/' || pid || '/number-of-users/x.exe', 'application/x-msdownload', 1, repeat('d', 64), 1, rev);
    raise exception 'executable mime accepted';
  exception when check_violation then null; end;
  begin update public.generated_documents set size_bytes = 1; raise exception 'document record modified';
  exception when insufficient_privilege then null; end;

  update public.generation_jobs set status = 'completed' where id = jid;
  if (select completed_at from public.generation_jobs where id = jid) is null then raise exception 'completed_at'; end if;
  begin update public.generation_jobs set status = 'failed' where id = jid; raise exception 'finished job changed';
  exception when raise_exception then
    if sqlerrm not like '%already finished%' then raise; end if;
  end;

  -- storage: only inside projects/<existing project>/..., immutable
  insert into storage.objects (bucket_id, name) values ('generated-documents', 'projects/' || pid || '/number-of-users/20261013-101500-r2.pdf');
  begin insert into storage.objects (bucket_id, name) values ('generated-documents', 'projects/' || gen_random_uuid() || '/x/y.pdf'); raise exception 'upload to unknown project';
  exception when insufficient_privilege then null; end;
  begin insert into storage.objects (bucket_id, name) values ('generated-documents', 'other/y.pdf'); raise exception 'upload outside projects/';
  exception when insufficient_privilege then null; end;
  update storage.objects set name = name || '.x' where bucket_id = 'generated-documents';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'generated document overwritten'; end if;
  delete from storage.objects where bucket_id = 'generated-documents';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'generated document deleted'; end if;
  insert into storage.objects (bucket_id, name) values ('project-files', 'projects/' || pid || '/photos/p1.jpg');
  delete from storage.objects where bucket_id = 'project-files';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'photo delete failed'; end if;
end $$;
reset role;

-- 4. the stranger still sees no rows anywhere
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
set role authenticated;
do $$ begin
  if exists (select 1 from public.projects) or exists (select 1 from public.generated_documents)
     or exists (select 1 from public.project_revisions) or exists (select 1 from storage.objects)
     or exists (select 1 from public.template_registry) then
    raise exception 'stranger can read data';
  end if;
end $$;
reset role;

-- 5. once MFA is enrolled, an aal1 session is not enough
insert into auth.mfa_factors (user_id, status) values ('11111111-1111-1111-1111-111111111111', 'verified');
select pg_temp.as_user('11111111-1111-1111-1111-111111111111', 'aal1');
set role authenticated;
do $$ begin if exists (select 1 from public.projects) then raise exception 'aal1 allowed with MFA enrolled'; end if; end $$;
reset role;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111', 'aal2');
set role authenticated;
do $$ begin if not exists (select 1 from public.projects) then raise exception 'aal2 rejected'; end if; end $$;
reset role;

-- 6. buckets are private and the seed loaded every template
do $$ begin
  if exists (select 1 from storage.buckets where public) then raise exception 'public bucket'; end if;
  if (select count(*) from public.template_registry) <> 18 then raise exception 'template seed'; end if;
end $$;
select 'ALL RLS TESTS PASSED' as result;
