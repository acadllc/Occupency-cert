-- Private company assets: the stamp + signature image used on generated documents.
-- It is uploaded from the dashboard (Settings) and never stored in the public repository or site.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('company-assets', 'company-assets', false, 2097152, array['image/png'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- only allow-listed users, and only the one known file name
drop policy if exists "company-assets: read" on storage.objects;
create policy "company-assets: read"
  on storage.objects for select to authenticated
  using (bucket_id = 'company-assets' and (select public.is_app_user()));

drop policy if exists "company-assets: create" on storage.objects;
create policy "company-assets: create"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'company-assets' and (select public.is_app_user()) and name = 'stamp-signature.png');

drop policy if exists "company-assets: replace" on storage.objects;
create policy "company-assets: replace"
  on storage.objects for update to authenticated
  using (bucket_id = 'company-assets' and (select public.is_app_user()))
  with check (bucket_id = 'company-assets' and (select public.is_app_user()) and name = 'stamp-signature.png');

drop policy if exists "company-assets: delete" on storage.objects;
create policy "company-assets: delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'company-assets' and (select public.is_app_user()));
