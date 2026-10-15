-- Project search also covers the municipality project number, owner phone and owner ID/passport number
-- (the separate reference number field was removed; the plot number is the reference).
alter table public.projects drop column if exists search_text;  -- also drops its trigram index
alter table public.projects add column search_text text generated always as (
  lower(
    coalesce(fields ->> 'project_id', '') || ' ' ||
    coalesce(fields ->> 'municipality_project_number', '') || ' ' ||
    coalesce(fields ->> 'owner_name_ar', '') || ' ' ||
    coalesce(fields ->> 'owner_name_en', '') || ' ' ||
    coalesce(fields ->> 'owner_phone', '') || ' ' ||
    coalesce(fields ->> 'owner_id_number', '') || ' ' ||
    coalesce(fields ->> 'plot_number', '') || ' ' ||
    coalesce(fields ->> 'area_ar', '') || ' ' ||
    coalesce(fields ->> 'area_en', '') || ' ' ||
    coalesce(fields ->> 'sector_ar', '') || ' ' ||
    coalesce(fields ->> 'sector_en', '')
  )
) stored;

do $$
declare s text;
begin
  select n.nspname into s from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm';
  execute format('create index if not exists projects_search_trgm_idx on public.projects using gin (search_text %I.gin_trgm_ops)', s);
end $$;
