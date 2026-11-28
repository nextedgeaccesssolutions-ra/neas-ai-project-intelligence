-- Client accounts: Report templates becomes view only (final reports of their projects); Project register is no longer
-- a client module. Clients never see the template library or a project's templates, only finished reports.
update neas.profiles set allowed_views = array['overview', 'project_management', 'field_reports', 'site_evidence', 'offline_queue']
where is_client;

create or replace function neas.admin_set_client(p_user uuid, p_client boolean) returns void
language plpgsql security definer set search_path = neas, extensions as $$
begin
  if not neas.is_super_admin() then raise exception 'Not authorized' using errcode = '42501'; end if;
  if exists (select 1 from neas.profiles where id = p_user and global_role = 'super_admin') and p_client then
    raise exception 'A Super Admin cannot be a client account' using errcode = '22023';
  end if;
  update neas.profiles set is_client = p_client,
    allowed_views = case when p_client then array['overview', 'project_management', 'field_reports', 'site_evidence', 'offline_queue'] else null end
  where id = p_user;
  if not found then raise exception 'User not found'; end if;
  if p_client then update neas.project_memberships set can_approve_reports = false, role = 'employee' where user_id = p_user; end if;
  perform neas.write_audit(case when p_client then 'account:made_client' else 'account:made_staff' end, null, 'profiles', p_user::text, '{}'::jsonb);
end $$;

-- the shared template library is for staff only (client module lists no longer mark who is a client)
drop policy if exists report_templates_read on neas.report_templates;
create policy report_templates_read on neas.report_templates for select to authenticated
  using (neas.is_super_admin() or neas.is_project_staff(project_id)
         or (project_id is null and neas.is_active_user() and not neas.is_client_account()
             and exists (select 1 from neas.profiles p where p.id = auth.uid() and p.allowed_views is distinct from array['overview']::text[])));

-- a client reads the finished (final) template reports of their projects; drafts stay with staff
drop policy if exists template_reports_read on neas.template_reports;
create policy template_reports_read on neas.template_reports for select to authenticated
  using (neas.is_super_admin() or neas.is_project_staff(project_id) or (neas.is_client(project_id) and status = 'final'));
