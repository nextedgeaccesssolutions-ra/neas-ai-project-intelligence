-- Access control set by the administrator:
--   * the owner account (bootstrap admin e-mail) becomes the first Super Admin once verified;
--     everyone else waits for that admin's approval before they can sign in to the workspace;
--   * per-user module views ("which screens can this person use"), enforced in the database for
--     the data behind each module, not only by hiding menu items.
-- Additive and idempotent.

-- ---------------------------------------------------------------------------
-- Settings (Super Admin only)
-- ---------------------------------------------------------------------------
create table if not exists neas.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table neas.app_settings enable row level security;
insert into neas.app_settings (key, value) values
  ('bootstrap_admin_email', 'info.nextedgeaccesssolutions@gmail.com'),
  ('admin_notify_email', 'info.nextedgeaccesssolutions@gmail.com')
on conflict (key) do nothing;
drop policy if exists settings_admin on neas.app_settings;
create policy settings_admin on neas.app_settings for all to authenticated
  using (neas.is_super_admin()) with check (neas.is_super_admin());
grant select, insert, update on neas.app_settings to authenticated;

-- The owner e-mail becomes Super Admin only while no active Super Admin exists, and only after
-- the e-mail address is verified. After that, every new account needs approval.
create or replace function neas.maybe_bootstrap_admin(p_user uuid) returns void
language plpgsql security definer set search_path = neas, extensions as $$
declare p record;
begin
  select * into p from neas.profiles where id = p_user;
  if not found or p.email_verified_at is null then return; end if;
  if lower(p.email) <> lower(coalesce((select value from neas.app_settings where key = 'bootstrap_admin_email'), '')) then return; end if;
  if exists (select 1 from neas.profiles where global_role = 'super_admin' and status = 'active') then return; end if;
  update neas.profiles set status = 'active', global_role = 'super_admin', approved_at = now(), status_reason = null where id = p_user;
  update neas.registration_requests set status = 'active', reviewed_at = now(), reason = 'Owner account' where user_id = p_user and status = 'pending';
  perform neas.write_audit('account:owner_bootstrapped', null, 'profiles', p_user::text, jsonb_build_object('email', p.email), 'system');
end $$;
revoke all on function neas.maybe_bootstrap_admin(uuid) from public, anon, authenticated;

create or replace function neas.handle_new_user() returns trigger
language plpgsql security definer set search_path = neas, extensions as $$
declare inv record;
begin
  insert into neas.profiles (id, email, full_name, email_verified_at)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''), new.email_confirmed_at)
  on conflict (id) do nothing;

  select * into inv from neas.project_invitations
  where lower(email) = lower(new.email) and status = 'pending' and expires_at > now()
  order by created_at desc limit 1;

  if found then
    update neas.profiles set status = 'active', approved_by = inv.invited_by, approved_at = now(),
      full_name = case when full_name = '' then inv.full_name else full_name end
    where id = new.id;
    insert into neas.project_memberships (project_id, user_id, role, added_by)
      select i.project_id, new.id, i.role, i.invited_by from neas.project_invitations i
      where lower(i.email) = lower(new.email) and i.status = 'pending' and i.expires_at > now() and i.project_id is not null
    on conflict do nothing;
    update neas.project_invitations set status = 'accepted', accepted_at = now()
      where lower(email) = lower(new.email) and status = 'pending' and expires_at > now();
    perform neas.write_audit('account:invited_user_created', null, 'profiles', new.id::text, jsonb_build_object('email', new.email), 'system');
  else
    insert into neas.registration_requests (user_id, email, full_name)
    values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
    perform neas.write_audit('account:registration_requested', null, 'profiles', new.id::text, jsonb_build_object('email', new.email), 'system');
    perform neas.maybe_bootstrap_admin(new.id);
  end if;
  return new;
end $$;

create or replace function neas.handle_user_verified() returns trigger
language plpgsql security definer set search_path = neas, extensions as $$
begin
  if new.email_confirmed_at is not null and old.email_confirmed_at is null then
    update neas.profiles set email_verified_at = new.email_confirmed_at where id = new.id;
    perform neas.maybe_bootstrap_admin(new.id);
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Per-user module views
-- ---------------------------------------------------------------------------
-- null = every module (the default); otherwise only the listed modules.
alter table neas.profiles add column if not exists allowed_views text[];
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_allowed_views_known') then
    alter table neas.profiles add constraint profiles_allowed_views_known check (
      allowed_views is null or allowed_views <@ array['overview','estimating','quotation','project_management','field_reports','projects','site_evidence','google_sheets','offline_queue']::text[]
    );
  end if;
end $$;

create or replace function neas.can_view(p_view text) returns boolean
language sql stable security definer set search_path = neas, extensions as $$
  select neas.is_super_admin() or exists (
    select 1 from neas.profiles p
    where p.id = auth.uid() and (p.allowed_views is null or p_view = any (p.allowed_views))
  ) and neas.is_active_user();
$$;
grant execute on function neas.can_view(text) to authenticated;

create or replace function neas.admin_set_views(p_user uuid, p_views text[]) returns void
language plpgsql security definer set search_path = neas, extensions as $$
begin
  if not neas.is_super_admin() then raise exception 'Not authorized' using errcode = '42501'; end if;
  update neas.profiles set allowed_views = p_views where id = p_user;
  if not found then raise exception 'User not found'; end if;
  perform neas.write_audit('account:views_changed', null, 'profiles', p_user::text,
    jsonb_build_object('views', coalesce(to_jsonb(p_views), '"all"'::jsonb)));
end $$;
grant execute on function neas.admin_set_views(uuid, text[]) to authenticated;

-- Data behind each module follows the module permission (Super Admins always pass).
drop policy if exists boq_manager on neas.boq_lines;
create policy boq_manager on neas.boq_lines for all to authenticated
  using (neas.is_super_admin() or (neas.is_manager(project_id) and (neas.can_view('estimating') or neas.can_view('quotation'))))
  with check (neas.is_super_admin() or (neas.is_manager(project_id) and neas.can_view('estimating')));
drop policy if exists cost_manager on neas.cost_settings;
create policy cost_manager on neas.cost_settings for all to authenticated
  using (neas.is_super_admin() or (neas.is_manager(project_id) and (neas.can_view('estimating') or neas.can_view('quotation'))))
  with check (neas.is_super_admin() or (neas.is_manager(project_id) and neas.can_view('estimating')));
drop policy if exists quotes_manager on neas.quotations;
create policy quotes_manager on neas.quotations for all to authenticated
  using (neas.is_super_admin() or (neas.is_manager(project_id) and (neas.can_view('quotation') or neas.can_view('estimating'))))
  with check (neas.is_super_admin() or (neas.is_manager(project_id) and neas.can_view('quotation')));

drop policy if exists activities_write on neas.activities;
create policy activities_write on neas.activities for all to authenticated
  using (neas.is_super_admin() or (neas.is_manager(project_id) and neas.can_view('project_management')))
  with check (neas.is_super_admin() or (neas.is_manager(project_id) and neas.can_view('project_management')));

drop policy if exists reports_insert on neas.project_reports;
create policy reports_insert on neas.project_reports for insert to authenticated
  with check (neas.is_super_admin() or (neas.is_member(project_id) and (neas.can_view('field_reports') or neas.can_view('project_management'))));

drop policy if exists attachments_insert on neas.report_attachments;
create policy attachments_insert on neas.report_attachments for insert to authenticated
  with check ((neas.is_super_admin() or (neas.is_member(project_id) and (neas.can_view('site_evidence') or neas.can_view('field_reports'))))
    and uploaded_by = auth.uid() and not client_visible);
