-- Private project photo storage. Object path: {project UUID}/{user UUID}/{filename}.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('neas-project-evidence','neas-project-evidence',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=5242880,allowed_mime_types=array['image/jpeg','image/png','image/webp'];
drop policy if exists neas_evidence_storage_read on storage.objects;
create policy neas_evidence_storage_read on storage.objects for select to authenticated
using(bucket_id='neas-project-evidence' and public.neas_is_project_member(((storage.foldername(name))[1])::uuid));
drop policy if exists neas_evidence_storage_insert on storage.objects;
create policy neas_evidence_storage_insert on storage.objects for insert to authenticated
with check(bucket_id='neas-project-evidence' and (storage.foldername(name))[2]=(select auth.uid())::text and public.neas_is_project_member(((storage.foldername(name))[1])::uuid));
drop policy if exists neas_evidence_storage_delete on storage.objects;
create policy neas_evidence_storage_delete on storage.objects for delete to authenticated
using(bucket_id='neas-project-evidence' and ((storage.foldername(name))[2]=(select auth.uid())::text or public.neas_can_manage_project(((storage.foldername(name))[1])::uuid)));
