-- NEAS AI Project Intelligence — platform core
-- Accounts, projects, memberships, project data, audit log and Row Level Security.
-- Additive only: creates new objects, never drops or rewrites existing data.
-- Review before applying to production. Apply to a preview/branch database first.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- Everything lives in its own schema so it cannot collide with tables, functions or
-- triggers that already exist in the production database (not yet audited).
-- Expose it in Supabase: Settings → API → Exposed schemas → add "neas".
create schema if not exists neas;
grant usage on schema neas to authenticated, service_role;
revoke all on schema neas from anon;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
do $$ begin
  create type neas.account_status as enum ('pending', 'active', 'rejected', 'suspended');
exception when duplicate_object then null; end $$;
do $$ begin
  create type neas.global_role as enum ('super_admin', 'staff');
exception when duplicate_object then null; end $$;
do $$ begin
  create type neas.project_role as enum ('project_manager', 'employee');
exception when duplicate_object then null; end $$;
do $$ begin
  create type neas.project_status as enum ('draft', 'active', 'suspended', 'completed', 'archived');
exception when duplicate_object then null; end $$;
do $$ begin
  create type neas.report_status as enum ('draft', 'submitted', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------
create table if not exists neas.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '',
  job_title text not null default '',
  global_role neas.global_role not null default 'staff',
  status neas.account_status not null default 'pending',
  email_verified_at timestamptz,
  approved_by uuid references neas.profiles (id),
  approved_at timestamptz,
  status_reason text,
  password_set_at timestamptz,
  password_reset_requested_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists profiles_email_key on neas.profiles (lower(email));

create table if not exists neas.registration_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references neas.profiles (id) on delete cascade,
  email text not null,
  full_name text not null default '',
  status neas.account_status not null default 'pending',
  reviewed_by uuid references neas.profiles (id),
  reviewed_at timestamptz,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists registration_requests_status_idx on neas.registration_requests (status, created_at desc);

-- ---------------------------------------------------------------------------
-- Projects and membership
-- ---------------------------------------------------------------------------
create table if not exists neas.projects (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9][A-Z0-9-]{2,39}$'),
  name text not null check (length(trim(name)) > 0),
  reference_no text not null default '',
  client_name text not null default '',
  site text not null default '',
  status neas.project_status not null default 'draft',
  start_date date,
  end_date date,
  contract_value numeric(14, 2) check (contract_value is null or contract_value >= 0),
  client_portal_enabled boolean not null default false,
  version integer not null default 1,
  created_by uuid references neas.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);

create table if not exists neas.project_memberships (
  project_id uuid not null references neas.projects (id) on delete cascade,
  user_id uuid not null references neas.profiles (id) on delete cascade,
  role neas.project_role not null default 'employee',
  can_approve_reports boolean not null default false,
  added_by uuid references neas.profiles (id),
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index if not exists project_memberships_user_idx on neas.project_memberships (user_id);

create table if not exists neas.project_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  full_name text not null default '',
  project_id uuid references neas.projects (id) on delete cascade,
  role neas.project_role not null default 'employee',
  invited_by uuid references neas.profiles (id),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists project_invitations_email_idx on neas.project_invitations (lower(email), status);

-- ---------------------------------------------------------------------------
-- Project data (every row carries project_id; versioned for offline conflict checks)
-- ---------------------------------------------------------------------------
create table if not exists neas.activities (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references neas.projects (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  start_date date not null,
  end_date date not null,
  weight numeric(6, 2) not null check (weight > 0 and weight <= 100),
  is_milestone boolean not null default false,
  client_visible boolean not null default true,
  sort_order integer not null default 0,
  version integer not null default 1,
  updated_by uuid references neas.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (end_date >= start_date)
);
create index if not exists activities_project_idx on neas.activities (project_id) where deleted_at is null;

create table if not exists neas.project_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references neas.projects (id) on delete cascade,
  activity_id uuid references neas.activities (id) on delete set null,
  report_type text not null default 'progress' check (report_type in ('progress', 'daily', 'inspection', 'checklist')),
  report_date date not null,
  actual_pct numeric(5, 2) check (actual_pct is null or (actual_pct >= 0 and actual_pct <= 100)),
  notes text not null default '',
  data jsonb not null default '{}'::jsonb,
  status neas.report_status not null default 'submitted',
  client_visible boolean not null default false,
  submitted_by uuid default auth.uid() references neas.profiles (id),
  reviewed_by uuid references neas.profiles (id),
  reviewed_at timestamptz,
  review_note text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists project_reports_project_idx on neas.project_reports (project_id, report_date desc) where deleted_at is null;

create table if not exists neas.report_attachments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references neas.projects (id) on delete cascade,
  report_id uuid references neas.project_reports (id) on delete cascade,
  activity_id uuid references neas.activities (id) on delete set null,
  kind text not null default 'during' check (kind in ('before', 'during', 'after', 'document')),
  storage_path text not null,
  caption text not null default '',
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  bytes integer not null check (bytes > 0 and bytes <= 10485760),
  client_visible boolean not null default false,
  uploaded_by uuid default auth.uid() references neas.profiles (id),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (storage_path like project_id::text || '/%')
);

-- Confidential commercial data (managers and Super Admin only)
create table if not exists neas.boq_lines (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references neas.projects (id) on delete cascade,
  item text not null default '',
  description text not null check (length(trim(description)) > 0),
  category text not null default 'Other' check (category in ('Labor', 'Materials', 'Equipment', 'Subcontract', 'Other')),
  unit text not null default 'lot',
  qty numeric(14, 3) not null check (qty > 0),
  unit_cost numeric(14, 2) not null check (unit_cost >= 0),
  version integer not null default 1,
  updated_by uuid references neas.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists neas.cost_settings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references neas.projects (id) on delete cascade,
  overhead_pct numeric(6, 2) not null default 10 check (overhead_pct between 0 and 100),
  contingency_pct numeric(6, 2) not null default 5 check (contingency_pct between 0 and 100),
  insurance_pct numeric(6, 2) not null default 0 check (insurance_pct between 0 and 100),
  bond_pct numeric(6, 2) not null default 0 check (bond_pct between 0 and 100),
  warranty_pct numeric(6, 2) not null default 0 check (warranty_pct between 0 and 100),
  markup_pct numeric(6, 2) not null default 15 check (markup_pct between 0 and 100),
  vat_pct numeric(6, 2) not null default 12 check (vat_pct between 0 and 100),
  vat_mode text not null default 'exclusive' check (vat_mode in ('exclusive', 'exempt')),
  version integer not null default 1,
  updated_by uuid references neas.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists neas.quotations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references neas.projects (id) on delete cascade,
  number text not null,
  status text not null default 'Draft' check (status in ('Draft', 'Submitted', 'Approved', 'Issued')),
  validity_days integer not null default 30 check (validity_days > 0),
  terms text not null default '',
  approved_by uuid references neas.profiles (id),
  approved_at timestamptz,
  issued_at timestamptz,
  approved_total numeric(14, 2),
  history jsonb not null default '[]'::jsonb,
  version integer not null default 1,
  updated_by uuid references neas.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Audit log (append-only)
-- ---------------------------------------------------------------------------
create table if not exists neas.audit_logs (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  actor_kind text not null default 'user' check (actor_kind in ('user', 'client', 'system')),
  action text not null,
  project_id uuid,
  target_type text,
  target_id text,
  details jsonb not null default '{}'::jsonb
);
create index if not exists audit_logs_at_idx on neas.audit_logs (at desc);
create index if not exists audit_logs_project_idx on neas.audit_logs (project_id, at desc);

-- ---------------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER so policies can read membership without recursion)
-- ---------------------------------------------------------------------------
create or replace function neas.is_active_user() returns boolean
language sql stable security definer set search_path = neas, extensions as $$
  select exists (
    select 1 from neas.profiles p
    where p.id = auth.uid() and p.status = 'active' and p.email_verified_at is not null
  );
$$;

create or replace function neas.is_super_admin() returns boolean
language sql stable security definer set search_path = neas, extensions as $$
  select exists (
    select 1 from neas.profiles p
    where p.id = auth.uid() and p.status = 'active' and p.email_verified_at is not null and p.global_role = 'super_admin'
  );
$$;

-- Member of an operational project (suspended/archived projects are closed to members).
create or replace function neas.is_member(p_project uuid) returns boolean
language sql stable security definer set search_path = neas, extensions as $$
  select neas.is_active_user() and exists (
    select 1 from neas.project_memberships m
    join neas.projects pr on pr.id = m.project_id
    where m.project_id = p_project and m.user_id = auth.uid()
      and pr.status in ('draft', 'active', 'completed')
  );
$$;

create or replace function neas.is_manager(p_project uuid) returns boolean
language sql stable security definer set search_path = neas, extensions as $$
  select neas.is_active_user() and exists (
    select 1 from neas.project_memberships m
    join neas.projects pr on pr.id = m.project_id
    where m.project_id = p_project and m.user_id = auth.uid() and m.role = 'project_manager'
      and pr.status in ('draft', 'active', 'completed')
  );
$$;

create or replace function neas.can_review(p_project uuid) returns boolean
language sql stable security definer set search_path = neas, extensions as $$
  select neas.is_super_admin() or neas.is_manager(p_project) or (
    neas.is_active_user() and exists (
      select 1 from neas.project_memberships m join neas.projects pr on pr.id = m.project_id
      where m.project_id = p_project and m.user_id = auth.uid() and m.can_approve_reports
        and pr.status in ('draft', 'active', 'completed')
    )
  );
$$;

create or replace function neas.shares_project(p_user uuid) returns boolean
language sql stable security definer set search_path = neas, extensions as $$
  select neas.is_active_user() and exists (
    select 1 from neas.project_memberships a
    join neas.project_memberships b on a.project_id = b.project_id
    where a.user_id = auth.uid() and b.user_id = p_user
  );
$$;

create or replace function neas.write_audit(p_action text, p_project uuid, p_target_type text, p_target_id text, p_details jsonb default '{}'::jsonb, p_actor_kind text default 'user')
returns void language sql security definer set search_path = neas, extensions as $$
  insert into neas.audit_logs (actor_id, actor_kind, action, project_id, target_type, target_id, details)
  values (auth.uid(), p_actor_kind, p_action, p_project, p_target_type, p_target_id, coalesce(p_details, '{}'::jsonb));
$$;

-- ---------------------------------------------------------------------------
-- Triggers: timestamps, versions, audit, report guard
-- ---------------------------------------------------------------------------
create or replace function neas.touch_row() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' and to_jsonb(new) ? 'version' then
    new.version := old.version + 1;
  end if;
  if to_jsonb(new) ? 'updated_by' and auth.uid() is not null then
    new.updated_by := auth.uid();
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles','projects','activities','project_reports','report_attachments','boq_lines','cost_settings','quotations'] loop
    execute format('drop trigger if exists touch_%1$s on neas.%1$s', t);
    execute format('create trigger touch_%1$s before update on neas.%1$s for each row execute function neas.touch_row()', t);
  end loop;
end $$;

create or replace function neas.audit_row() returns trigger
language plpgsql security definer set search_path = neas, extensions as $$
declare
  rec jsonb := to_jsonb(coalesce(new, old));
  diff jsonb := '{}'::jsonb;
  k text;
begin
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(to_jsonb(new)) loop
      if k not in ('updated_at', 'version', 'passcode_hash') and (to_jsonb(new) -> k) is distinct from (to_jsonb(old) -> k) then
        diff := diff || jsonb_build_object(k, jsonb_build_object('from', to_jsonb(old) -> k, 'to', to_jsonb(new) -> k));
      end if;
    end loop;
    if diff = '{}'::jsonb then return new; end if;
  end if;
  insert into neas.audit_logs (actor_id, action, project_id, target_type, target_id, details)
  values (
    auth.uid(),
    lower(tg_op) || ':' || tg_table_name,
    case when rec ? 'project_id' then (rec ->> 'project_id')::uuid when tg_table_name = 'projects' then (rec ->> 'id')::uuid end,
    tg_table_name,
    coalesce(rec ->> 'id', rec ->> 'user_id'),
    case when tg_op = 'UPDATE' then diff else rec - 'passcode_hash' end
  );
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles','projects','project_memberships','project_invitations','boq_lines','cost_settings','quotations'] loop
    execute format('drop trigger if exists audit_%1$s on neas.%1$s', t);
    execute format('create trigger audit_%1$s after insert or update or delete on neas.%1$s for each row execute function neas.audit_row()', t);
  end loop;
end $$;

-- Employees may file and edit their own unreviewed reports; only reviewers change review fields.
create or replace function neas.guard_report() returns trigger
language plpgsql security definer set search_path = neas, extensions as $$
declare reviewer boolean := neas.can_review(new.project_id);
begin
  if tg_op = 'INSERT' then
    new.submitted_by := coalesce(auth.uid(), new.submitted_by);
    if not reviewer then
      if new.status not in ('draft', 'submitted') then raise exception 'Only a reviewer can approve or reject reports' using errcode = '42501'; end if;
      new.reviewed_by := null; new.reviewed_at := null; new.review_note := null; new.client_visible := false;
    end if;
    return new;
  end if;
  if new.project_id <> old.project_id then raise exception 'A report cannot move to another project' using errcode = '42501'; end if;
  if not reviewer then
    if old.status in ('approved', 'rejected') then raise exception 'Reviewed reports are locked' using errcode = '42501'; end if;
    if new.status not in ('draft', 'submitted') or new.reviewed_by is distinct from old.reviewed_by
       or new.client_visible is distinct from old.client_visible or new.submitted_by is distinct from old.submitted_by then
      raise exception 'Only a reviewer can change review fields' using errcode = '42501';
    end if;
  elsif new.status is distinct from old.status and new.status in ('approved', 'rejected') then
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
    perform neas.write_audit('report:' || new.status, new.project_id, 'project_reports', new.id::text, jsonb_build_object('note', new.review_note));
  end if;
  return new;
end $$;
drop trigger if exists guard_project_reports on neas.project_reports;
create trigger guard_project_reports before insert or update on neas.project_reports for each row execute function neas.guard_report();

-- An issued quotation is locked, and its BOQ with it.
create or replace function neas.guard_boq() returns trigger
language plpgsql security definer set search_path = neas, extensions as $$
declare pid uuid := coalesce(new.project_id, old.project_id);
begin
  if exists (select 1 from neas.quotations q where q.project_id = pid and q.status = 'Issued') then
    raise exception 'The quotation for this project is issued; the BOQ is locked' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists guard_boq_lines on neas.boq_lines;
create trigger guard_boq_lines before insert or update or delete on neas.boq_lines for each row execute function neas.guard_boq();

-- New auth user → pending profile + registration request (or active profile when invited).
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
  end if;
  return new;
end $$;
drop trigger if exists neas_on_auth_user_created on auth.users;
create trigger neas_on_auth_user_created after insert on auth.users for each row execute function neas.handle_new_user();

-- Email verification flows into the profile.
create or replace function neas.handle_user_verified() returns trigger
language plpgsql security definer set search_path = neas, extensions as $$
begin
  if new.email_confirmed_at is not null and old.email_confirmed_at is null then
    update neas.profiles set email_verified_at = new.email_confirmed_at where id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists neas_on_auth_user_verified on auth.users;
create trigger neas_on_auth_user_verified after update on auth.users for each row execute function neas.handle_user_verified();

-- ---------------------------------------------------------------------------
-- Administration functions (each checks Super Admin and writes the audit log)
-- ---------------------------------------------------------------------------
create or replace function neas.admin_review_registration(p_user uuid, p_approve boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = neas, extensions as $$
begin
  if not neas.is_super_admin() then raise exception 'Not authorized' using errcode = '42501'; end if;
  update neas.profiles
    set status = case when p_approve then 'active'::neas.account_status else 'rejected'::neas.account_status end,
        approved_by = case when p_approve then auth.uid() end,
        approved_at = case when p_approve then now() end,
        status_reason = p_reason
  where id = p_user and status in ('pending', 'rejected');
  if not found then raise exception 'No pending registration for this user'; end if;
  update neas.registration_requests set status = case when p_approve then 'active'::neas.account_status else 'rejected'::neas.account_status end,
    reviewed_by = auth.uid(), reviewed_at = now(), reason = p_reason
  where user_id = p_user and status = 'pending';
end $$;

create or replace function neas.admin_set_user_status(p_user uuid, p_status neas.account_status, p_reason text default null)
returns void language plpgsql security definer set search_path = neas, extensions as $$
begin
  if not neas.is_super_admin() then raise exception 'Not authorized' using errcode = '42501'; end if;
  if p_user = auth.uid() and p_status <> 'active' then raise exception 'You cannot suspend your own account'; end if;
  if p_status = 'pending' then raise exception 'Use registration review for pending accounts'; end if;
  update neas.profiles set status = p_status, status_reason = p_reason where id = p_user;
  if not found then raise exception 'User not found'; end if;
end $$;

create or replace function neas.admin_set_global_role(p_user uuid, p_role neas.global_role)
returns void language plpgsql security definer set search_path = neas, extensions as $$
begin
  if not neas.is_super_admin() then raise exception 'Not authorized' using errcode = '42501'; end if;
  if p_user = auth.uid() and p_role <> 'super_admin' then raise exception 'You cannot remove your own Super Admin role'; end if;
  update neas.profiles set global_role = p_role where id = p_user;
end $$;

-- ---------------------------------------------------------------------------
-- Privileges: deny by default, then grant what policies govern
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon;

grant select on neas.profiles to authenticated;
grant update (full_name, job_title) on neas.profiles to authenticated;
grant select on neas.registration_requests to authenticated;
grant select, insert, update, delete on neas.projects to authenticated;
grant select, insert, update, delete on neas.project_memberships to authenticated;
grant select, insert, update on neas.project_invitations to authenticated;
grant select, insert, update, delete on neas.activities to authenticated;
grant select, insert, update on neas.project_reports to authenticated;
grant select, insert, update on neas.report_attachments to authenticated;
grant select, insert, update, delete on neas.boq_lines to authenticated;
grant select, insert, update on neas.cost_settings to authenticated;
grant select, insert, update on neas.quotations to authenticated;
grant select on neas.audit_logs to authenticated;
grant execute on function neas.is_active_user(), neas.is_super_admin(), neas.is_member(uuid), neas.is_manager(uuid), neas.can_review(uuid), neas.shares_project(uuid) to authenticated;
grant execute on function neas.admin_review_registration(uuid, boolean, text), neas.admin_set_user_status(uuid, neas.account_status, text), neas.admin_set_global_role(uuid, neas.global_role) to authenticated;
revoke execute on function neas.write_audit(text, uuid, text, text, jsonb, text) from authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table neas.profiles enable row level security;
alter table neas.registration_requests enable row level security;
alter table neas.projects enable row level security;
alter table neas.project_memberships enable row level security;
alter table neas.project_invitations enable row level security;
alter table neas.activities enable row level security;
alter table neas.project_reports enable row level security;
alter table neas.report_attachments enable row level security;
alter table neas.boq_lines enable row level security;
alter table neas.cost_settings enable row level security;
alter table neas.quotations enable row level security;
alter table neas.audit_logs enable row level security;

-- profiles: yourself (even while pending, so the app can show your status), teammates, Super Admin
drop policy if exists profiles_select on neas.profiles;
create policy profiles_select on neas.profiles for select to authenticated
  using (id = auth.uid() or neas.is_super_admin() or neas.shares_project(id));
drop policy if exists profiles_update_self on neas.profiles;
create policy profiles_update_self on neas.profiles for update to authenticated
  using (id = auth.uid() and neas.is_active_user()) with check (id = auth.uid());

drop policy if exists registration_select on neas.registration_requests;
create policy registration_select on neas.registration_requests for select to authenticated
  using (neas.is_super_admin() or user_id = auth.uid());

-- projects
drop policy if exists projects_select on neas.projects;
create policy projects_select on neas.projects for select to authenticated
  using (neas.is_super_admin() or neas.is_member(id));
drop policy if exists projects_admin_write on neas.projects;
create policy projects_admin_write on neas.projects for all to authenticated
  using (neas.is_super_admin()) with check (neas.is_super_admin());

-- memberships: Super Admin all; managers see their team and add/remove employees
drop policy if exists memberships_select on neas.project_memberships;
create policy memberships_select on neas.project_memberships for select to authenticated
  using (neas.is_super_admin() or user_id = auth.uid() and neas.is_active_user() or neas.is_manager(project_id));
drop policy if exists memberships_insert on neas.project_memberships;
create policy memberships_insert on neas.project_memberships for insert to authenticated
  with check (neas.is_super_admin() or (neas.is_manager(project_id) and role = 'employee' and not can_approve_reports));
drop policy if exists memberships_update on neas.project_memberships;
create policy memberships_update on neas.project_memberships for update to authenticated
  using (neas.is_super_admin()) with check (neas.is_super_admin());
drop policy if exists memberships_delete on neas.project_memberships;
create policy memberships_delete on neas.project_memberships for delete to authenticated
  using (neas.is_super_admin() or (neas.is_manager(project_id) and role = 'employee'));

drop policy if exists invitations_admin on neas.project_invitations;
create policy invitations_admin on neas.project_invitations for all to authenticated
  using (neas.is_super_admin()) with check (neas.is_super_admin());

-- activities (schedule): members read, managers write
drop policy if exists activities_select on neas.activities;
create policy activities_select on neas.activities for select to authenticated
  using (neas.is_super_admin() or neas.is_member(project_id));
drop policy if exists activities_write on neas.activities;
create policy activities_write on neas.activities for all to authenticated
  using (neas.is_super_admin() or neas.is_manager(project_id))
  with check (neas.is_super_admin() or neas.is_manager(project_id));

-- reports: reviewers see all of the project; employees see their own and approved ones
drop policy if exists reports_select on neas.project_reports;
create policy reports_select on neas.project_reports for select to authenticated
  using (neas.can_review(project_id) or (neas.is_member(project_id) and (submitted_by = auth.uid() or status = 'approved')));
drop policy if exists reports_insert on neas.project_reports;
create policy reports_insert on neas.project_reports for insert to authenticated
  with check (neas.is_super_admin() or neas.is_member(project_id));
drop policy if exists reports_update on neas.project_reports;
create policy reports_update on neas.project_reports for update to authenticated
  using (neas.can_review(project_id) or (neas.is_member(project_id) and submitted_by = auth.uid()))
  with check (neas.can_review(project_id) or (neas.is_member(project_id) and submitted_by = auth.uid()));

drop policy if exists attachments_select on neas.report_attachments;
create policy attachments_select on neas.report_attachments for select to authenticated
  using (neas.can_review(project_id) or (neas.is_member(project_id) and (uploaded_by = auth.uid() or client_visible)));
drop policy if exists attachments_insert on neas.report_attachments;
create policy attachments_insert on neas.report_attachments for insert to authenticated
  with check ((neas.is_super_admin() or neas.is_member(project_id)) and uploaded_by = auth.uid() and not client_visible);
drop policy if exists attachments_update on neas.report_attachments;
create policy attachments_update on neas.report_attachments for update to authenticated
  using (neas.can_review(project_id)) with check (neas.can_review(project_id));

-- confidential commercial data
drop policy if exists boq_manager on neas.boq_lines;
create policy boq_manager on neas.boq_lines for all to authenticated
  using (neas.is_super_admin() or neas.is_manager(project_id)) with check (neas.is_super_admin() or neas.is_manager(project_id));
drop policy if exists cost_manager on neas.cost_settings;
create policy cost_manager on neas.cost_settings for all to authenticated
  using (neas.is_super_admin() or neas.is_manager(project_id)) with check (neas.is_super_admin() or neas.is_manager(project_id));
drop policy if exists quotes_manager on neas.quotations;
create policy quotes_manager on neas.quotations for all to authenticated
  using (neas.is_super_admin() or neas.is_manager(project_id)) with check (neas.is_super_admin() or neas.is_manager(project_id));

drop policy if exists audit_admin on neas.audit_logs;
create policy audit_admin on neas.audit_logs for select to authenticated using (neas.is_super_admin());
