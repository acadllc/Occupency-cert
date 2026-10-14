-- Allow generated Word (.docx) documents next to PDFs. Safe to run more than once.
update storage.buckets
set allowed_mime_types = array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
where id = 'generated-documents';

alter table public.generated_documents drop constraint if exists generated_documents_mime_type_check;
alter table public.generated_documents add constraint generated_documents_mime_type_check
  check (mime_type in ('application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'));
