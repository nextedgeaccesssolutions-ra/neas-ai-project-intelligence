-- Enforce least-privilege field reporting and evidence uploads.
drop policy if exists reports_insert_assigned on public.field_reports;
create policy reports_insert_assigned on public.field_reports for insert to authenticated
with check (
 reported_by=(select auth.uid()) and public.neas_is_project_member(project_id)
 and (public.neas_current_role()='admin' or exists(
   select 1 from public.project_memberships pm where pm.project_id=field_reports.project_id
   and pm.user_id=(select auth.uid()) and pm.project_role in ('admin','project_manager','supervisor','technician')))
 and exists(select 1 from public.project_activities a where a.id=activity_id and a.project_id=field_reports.project_id)
);
drop policy if exists evidence_insert_member on public.project_evidence;
create policy evidence_insert_member on public.project_evidence for insert to authenticated
with check (
 uploaded_by=(select auth.uid()) and public.neas_is_project_member(project_id)
 and (public.neas_current_role()='admin' or exists(
   select 1 from public.project_memberships pm where pm.project_id=project_evidence.project_id
   and pm.user_id=(select auth.uid()) and pm.project_role in ('admin','project_manager','supervisor','technician')))
);
drop policy if exists neas_evidence_storage_insert on storage.objects;
create policy neas_evidence_storage_insert on storage.objects for insert to authenticated
with check (
 bucket_id='neas-project-evidence' and (storage.foldername(name))[2]=(select auth.uid())::text
 and public.neas_is_project_member(((storage.foldername(name))[1])::uuid)
 and (public.neas_current_role()='admin' or exists(
   select 1 from public.project_memberships pm where pm.project_id=((storage.foldername(name))[1])::uuid
   and pm.user_id=(select auth.uid()) and pm.project_role in ('admin','project_manager','supervisor','technician')))
);
