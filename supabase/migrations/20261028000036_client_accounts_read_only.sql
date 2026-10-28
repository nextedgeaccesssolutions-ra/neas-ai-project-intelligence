-- Client accounts inside the app: they open Overview, Schedule & Gantt, Field reports, Project register,
-- Site evidence and the Offline queue for their projects, but read only, and only what is shared with the client:
-- approved, client-visible reports, client-visible photos and client-visible activities.
-- A client is an ordinary project membership on an account flagged is_client. neas.is_member() now excludes
-- client accounts, so every existing write rule (and every staff read) closes to them automatically; the read
-- rules below add the filtered client view.
alter table neas.profiles add column if not exists is_client boolean not null default false;

-- accounts already made "client (reports only)" become client accounts with the client modules
update neas.profiles set is_client = true,
  allowed_views = array['overview', 'project_management', 'field_reports', 'projects', 'site_evidence', 'offline_queue']
where global_role <> 'super_admin' and allowed_views = array['overview'];

create or replace function neas.is_client_account() returns boolean
language sql stable security definer set search_path = neas, extensions as $$
  select coalesce((select p.is_client and p.global_role <> 'super_admin' from neas.profiles p where p.id = auth.uid()), false);
$$;

-- staff member of an operational project (client accounts are not staff members)
create or replace function neas.is_member(p_project uuid) returns boolean
language sql stable security definer set search_path = neas, extensions as $$
  select neas.is_active_user() and not neas.is_client_account() and exists (
    select 1 from neas.project_memberships m
    join neas.projects pr on pr.id = m.project_id
    where m.project_id = p_project and m.user_id = auth.uid()
      and pr.status in ('draft', 'active', 'completed')
  );
$$;

-- client of an operational project: read-only, shared items only
create or replace function neas.is_client(p_project uuid) returns boolean
language sql stable security definer set search_path = neas, extensions as $$
  select neas.is_active_user() and neas.is_client_account() and exists (
    select 1 from neas.project_memberships m
    join neas.projects pr on pr.id = m.project_id
    where m.project_id = p_project and m.user_id = auth.uid()
      and pr.status in ('draft', 'active', 'completed')
  );
$$;
revoke execute on function neas.is_client_account() from public, anon;
revoke execute on function neas.is_client(uuid) from public, anon;
grant execute on function neas.is_client_account() to authenticated;
grant execute on function neas.is_client(uuid) to authenticated;

-- a client account never manages or approves
create or replace function neas.is_manager(p_project uuid) returns boolean
language sql stable security definer set search_path = neas, extensions as $$
  select neas.is_active_user() and not neas.is_client_account() and exists (
    select 1 from neas.project_memberships m
    join neas.projects pr on pr.id = m.project_id
    where m.project_id = p_project and m.user_id = auth.uid() and m.role = 'project_manager'
      and pr.status in ('draft', 'active', 'completed')
  );
$$;
create or replace function neas.can_review(p_project uuid) returns boolean
language sql stable security definer set search_path = neas, extensions as $$
  select neas.is_super_admin() or neas.is_manager(p_project) or (
    neas.is_active_user() and not neas.is_client_account() and exists (
      select 1 from neas.project_memberships m join neas.projects pr on pr.id = m.project_id
      where m.project_id = p_project and m.user_id = auth.uid() and m.can_approve_reports
        and pr.status in ('draft', 'active', 'completed')
    )
  );
$$;

-- Super Admin switch between staff and client; the client modules come with it
create or replace function neas.admin_set_client(p_user uuid, p_client boolean) returns void
language plpgsql security definer set search_path = neas, extensions as $$
begin
  if not neas.is_super_admin() then raise exception 'Not authorized' using errcode = '42501'; end if;
  if exists (select 1 from neas.profiles where id = p_user and global_role = 'super_admin') and p_client then
    raise exception 'A Super Admin cannot be a client account' using errcode = '22023';
  end if;
  update neas.profiles set is_client = p_client,
    allowed_views = case when p_client then array['overview', 'project_management', 'field_reports', 'projects', 'site_evidence', 'offline_queue'] else null end
  where id = p_user;
  if not found then raise exception 'User not found'; end if;
  if p_client then update neas.project_memberships set can_approve_reports = false, role = 'employee' where user_id = p_user; end if;
  perform neas.write_audit(case when p_client then 'account:made_client' else 'account:made_staff' end, null, 'profiles', p_user::text, '{}'::jsonb);
end $$;
revoke all on function neas.admin_set_client(uuid, boolean) from public, anon;
grant execute on function neas.admin_set_client(uuid, boolean) to authenticated;

-- choosing modules by hand makes the account staff again (only admin_set_client makes a client)
create or replace function neas.admin_set_views(p_user uuid, p_views text[]) returns void
language plpgsql security definer set search_path = neas, extensions as $$
begin
  if not neas.is_super_admin() then raise exception 'Not authorized' using errcode = '42501'; end if;
  update neas.profiles set allowed_views = p_views, is_client = false where id = p_user;
  if not found then raise exception 'User not found'; end if;
  perform neas.write_audit('account:views_changed', null, 'profiles', p_user::text,
    jsonb_build_object('views', coalesce(to_jsonb(p_views), '"all"'::jsonb)));
end $$;

-- read rules: staff as before, plus the client's shared view
drop policy if exists projects_select on neas.projects;
create policy projects_select on neas.projects for select to authenticated
  using (neas.is_super_admin() or neas.is_member(id) or neas.is_client(id));
drop policy if exists activities_select on neas.activities;
create policy activities_select on neas.activities for select to authenticated
  using (neas.is_super_admin() or neas.is_member(project_id) or (neas.is_client(project_id) and client_visible and deleted_at is null));
drop policy if exists reports_select on neas.project_reports;
create policy reports_select on neas.project_reports for select to authenticated
  using (neas.can_review(project_id) or (neas.is_member(project_id) and (submitted_by = auth.uid() or status = 'approved'))
    or (neas.is_client(project_id) and status = 'approved' and client_visible and deleted_at is null));
drop policy if exists attachments_select on neas.report_attachments;
create policy attachments_select on neas.report_attachments for select to authenticated
  using (neas.can_review(project_id) or (neas.is_member(project_id) and (uploaded_by = auth.uid() or client_visible))
    or (neas.is_client(project_id) and client_visible and deleted_at is null));
drop policy if exists project_calendars_select on neas.project_calendars;
create policy project_calendars_select on neas.project_calendars for select to authenticated
  using (neas.is_super_admin() or neas.is_member(project_id) or neas.is_client(project_id));
drop policy if exists activity_stops_select on neas.activity_stops;
create policy activity_stops_select on neas.activity_stops for select to authenticated
  using (neas.is_super_admin() or neas.is_member(project_id) or neas.is_client(project_id));
drop policy if exists report_cover_settings_read on neas.report_cover_settings;
create policy report_cover_settings_read on neas.report_cover_settings for select to authenticated
  using (neas.is_super_admin() or neas.is_member(project_id) or neas.is_client(project_id));

-- photo files: a client reads only client-visible photos
create or replace function neas.can_read_object(p_name text, p_owner uuid)
returns boolean language sql stable security definer set search_path = neas, extensions as $$
  select neas.is_super_admin()
    or (p_owner = auth.uid() and neas.is_member(neas.path_project(p_name)))
    or exists (
      select 1 from neas.report_attachments f
      where f.storage_path = p_name and f.deleted_at is null
        and (neas.can_review(f.project_id) or (neas.is_member(f.project_id) and (f.uploaded_by = auth.uid() or f.client_visible))
          or (neas.is_client(f.project_id) and f.client_visible))
    );
$$;
