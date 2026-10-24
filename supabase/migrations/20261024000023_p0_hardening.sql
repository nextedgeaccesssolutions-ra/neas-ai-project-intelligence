-- P0 hardening (engineering audit, 2026-10-24).
-- 1. Function permissions: no function in schema neas is executable by PUBLIC or anon.
--    Signed-in users get the functions the app calls and the helpers RLS policies use;
--    server-only functions (audit writer, client portal, share links, setup codes, internals)
--    are reachable by the service role only. Postgres grants EXECUTE to PUBLIC by default,
--    which let any signed-in user call neas.write_audit and forge audit entries.
-- 2. Storage: a project member no longer reads or overwrites every file in the project.
--    Reading follows the attachment's own visibility; overwriting is limited to the uploader
--    and is refused once the photo's report is approved.

alter default privileges in schema neas revoke execute on functions from public;

do $$
declare
  f record;
  server_only constant text[] := array[
    'write_audit', 'approved_project_view', 'share_snapshot', 'client_login', 'client_logout', 'client_snapshot',
    'redeem_setup_code', 'import_legacy_public', 'recovery_snapshot', 'view_item_project'];
begin
  for f in
    select p.oid::regprocedure as sig, p.proname, p.prorettype = 'trigger'::regtype as is_trigger
    from pg_proc p where p.pronamespace = 'neas'::regnamespace and p.prokind = 'f'
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    if f.is_trigger then
      execute format('revoke execute on function %s from authenticated', f.sig);
    elsif f.proname = any (server_only) then
      execute format('revoke execute on function %s from authenticated', f.sig);
      execute format('grant execute on function %s to service_role', f.sig);
    else
      execute format('grant execute on function %s to authenticated, service_role', f.sig);
    end if;
  end loop;
end $$;

-- 2. Storage objects follow the attachment rules (neas.report_attachments, attachments_select).
create or replace function neas.can_read_object(p_name text, p_owner uuid)
returns boolean language sql stable security definer set search_path = neas, extensions as $$
  select neas.is_super_admin()
    or (p_owner = auth.uid() and neas.is_member(neas.path_project(p_name)))
    or exists (
      select 1 from neas.report_attachments f
      where f.storage_path = p_name and f.deleted_at is null
        and (neas.can_review(f.project_id) or (neas.is_member(f.project_id) and (f.uploaded_by = auth.uid() or f.client_visible)))
    );
$$;

-- overwrite (upsert retry) only by the uploader, and never once the photo's report is approved
create or replace function neas.can_overwrite_object(p_name text, p_owner uuid)
returns boolean language sql stable security definer set search_path = neas, extensions as $$
  select neas.is_super_admin() or (
    p_owner = auth.uid() and neas.is_member(neas.path_project(p_name))
    and not exists (
      select 1 from neas.report_attachments f join neas.project_reports r on r.id = f.report_id
      where f.storage_path = p_name and r.status = 'approved'
    )
  );
$$;
revoke execute on function neas.can_read_object(text, uuid) from public, anon;
revoke execute on function neas.can_overwrite_object(text, uuid) from public, anon;
grant execute on function neas.can_read_object(text, uuid) to authenticated, service_role;
grant execute on function neas.can_overwrite_object(text, uuid) to authenticated, service_role;

drop policy if exists neas_files_select on storage.objects;
create policy neas_files_select on storage.objects for select to authenticated
  using (bucket_id = 'neas-project-files' and neas.can_read_object(name, owner));

drop policy if exists neas_files_update on storage.objects;
create policy neas_files_update on storage.objects for update to authenticated
  using (bucket_id = 'neas-project-files' and neas.can_overwrite_object(name, owner))
  with check (bucket_id = 'neas-project-files' and neas.can_overwrite_object(name, owner));
