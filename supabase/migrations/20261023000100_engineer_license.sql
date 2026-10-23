-- Private company assets: also the designer engineer's licence card (JPEG) printed on the
-- Project Description form. Like the stamp, it is uploaded from Settings and never stored in the
-- public repository or site.
update storage.buckets
  set allowed_mime_types = array['image/png', 'image/jpeg']
  where id = 'company-assets';

-- only allow-listed users, and only the known file names
drop policy if exists "company-assets: create" on storage.objects;
create policy "company-assets: create"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'company-assets' and (select public.is_app_user()) and name in ('stamp-signature.png', 'engineer-license.jpg'));

drop policy if exists "company-assets: replace" on storage.objects;
create policy "company-assets: replace"
  on storage.objects for update to authenticated
  using (bucket_id = 'company-assets' and (select public.is_app_user()))
  with check (bucket_id = 'company-assets' and (select public.is_app_user()) and name in ('stamp-signature.png', 'engineer-license.jpg'));
