-- NEAS AI Project Intelligence core schema migration
-- Apply only to Supabase project smlxekhbaefbvdbfxpew.
create extension if not exists pgcrypto;
create or replace function public.neas_current_role()
returns text language sql stable security definer set search_path=public
as $$ select coalesce((select ur.role::text from public.user_roles ur where ur.user_id=(select auth.uid()) and ur.active=true limit 1),'viewer'); $$;
revoke all on function public.neas_current_role() from public;
grant execute on function public.neas_current_role() to authenticated;

create table if not exists public.projects (
 id uuid primary key default gen_random_uuid(), project_code text not null unique, name text not null,
 client_name text not null default '', location text not null default '',
 status text not null default 'planning' check(status in ('planning','active','on_hold','completed','cancelled')),
 start_date date not null, end_date date not null, contract_value numeric(14,2) not null default 0 check(contract_value>=0),
 created_by uuid not null references auth.users(id) on delete restrict, created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(), check(end_date>=start_date)
);
create table if not exists public.project_memberships (
 project_id uuid not null references public.projects(id) on delete cascade, user_id uuid not null references auth.users(id) on delete cascade,
 project_role text not null default 'viewer' check(project_role in ('admin','estimator','project_manager','supervisor','technician','viewer')),
 created_at timestamptz not null default now(), primary key(project_id,user_id)
);
create table if not exists public.project_activities (
 id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade,
 name text not null, start_date date not null, end_date date not null, weight numeric(5,2) not null check(weight>=0 and weight<=100),
 sort_order integer not null default 0, created_by uuid not null references auth.users(id) on delete restrict,
 created_at timestamptz not null default now(), check(end_date>=start_date)
);
create table if not exists public.field_reports (
 id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade,
 activity_id uuid not null references public.project_activities(id) on delete cascade,
 reported_by uuid not null references auth.users(id) on delete restrict, report_date date not null default current_date,
 percent_complete numeric(5,2) not null check(percent_complete>=0 and percent_complete<=100), notes text not null default '',
 created_at timestamptz not null default now()
);
create table if not exists public.project_evidence (
 id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete cascade,
 activity_id uuid references public.project_activities(id) on delete set null,
 uploaded_by uuid not null references auth.users(id) on delete restrict,
 photo_type text not null check(photo_type in ('before','during','after')), caption text not null default '',
 storage_path text not null, created_at timestamptz not null default now()
);
create table if not exists public.estimates (
 id uuid primary key default gen_random_uuid(), project_id uuid references public.projects(id) on delete set null,
 estimate_number text not null unique, record_type text not null check(record_type in ('boq','quotation')),
 title text not null, client_name text not null default '', currency text not null default 'PHP' check(currency in ('PHP','USD')),
 line_items jsonb not null default '[]'::jsonb, subtotal numeric(14,2) not null default 0,
 markup_percent numeric(6,2) not null default 0, vat_percent numeric(6,2) not null default 12,
 total numeric(14,2) not null default 0, status text not null default 'draft' check(status in ('draft','for_review','approved','sent','rejected')),
 created_by uuid not null references auth.users(id) on delete restrict, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists projects_created_by_idx on public.projects(created_by);
create index if not exists memberships_user_idx on public.project_memberships(user_id);
create index if not exists activities_project_idx on public.project_activities(project_id,start_date);
create index if not exists field_reports_project_date_idx on public.field_reports(project_id,report_date desc);
create index if not exists evidence_project_idx on public.project_evidence(project_id,created_at desc);
create index if not exists estimates_project_idx on public.estimates(project_id,created_at desc);

create or replace function public.neas_is_project_member(pid uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select public.neas_current_role()='admin' or exists(select 1 from public.project_memberships pm where pm.project_id=pid and pm.user_id=(select auth.uid())); $$;
create or replace function public.neas_can_manage_project(pid uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select public.neas_current_role()='admin' or exists(select 1 from public.project_memberships pm where pm.project_id=pid and pm.user_id=(select auth.uid()) and pm.project_role in ('admin','project_manager')); $$;
revoke all on function public.neas_is_project_member(uuid) from public;
revoke all on function public.neas_can_manage_project(uuid) from public;
grant execute on function public.neas_is_project_member(uuid) to authenticated;
grant execute on function public.neas_can_manage_project(uuid) to authenticated;

create or replace function public.neas_add_project_creator() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into public.project_memberships(project_id,user_id,project_role) values(new.id,new.created_by,case when public.neas_current_role()='admin' then 'admin' else 'project_manager' end) on conflict do nothing; return new; end; $$;
drop trigger if exists neas_project_creator_membership on public.projects;
create trigger neas_project_creator_membership after insert on public.projects for each row execute function public.neas_add_project_creator();

create or replace function public.neas_handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into public.profiles(id,email,full_name,role) values(new.id,new.email,coalesce(new.raw_user_meta_data->>'full_name',''),'user') on conflict(id) do nothing;
 insert into public.user_roles(user_id,role,active) values(new.id,'viewer',true) on conflict(user_id) do nothing;
 return new;
end; $$;
drop trigger if exists neas_on_auth_user_created on auth.users;
create trigger neas_on_auth_user_created after insert on auth.users for each row execute function public.neas_handle_new_user();

alter table public.projects enable row level security;
alter table public.project_memberships enable row level security;
alter table public.project_activities enable row level security;
alter table public.field_reports enable row level security;
alter table public.project_evidence enable row level security;
alter table public.estimates enable row level security;
revoke all on public.projects,public.project_memberships,public.project_activities,public.field_reports,public.project_evidence,public.estimates from anon;
grant select,insert,update,delete on public.projects,public.project_memberships,public.project_activities,public.field_reports,public.project_evidence,public.estimates to authenticated;

drop policy if exists projects_select_member on public.projects;
create policy projects_select_member on public.projects for select to authenticated using(public.neas_is_project_member(id));
drop policy if exists projects_insert_manager on public.projects;
create policy projects_insert_manager on public.projects for insert to authenticated with check(created_by=(select auth.uid()) and public.neas_current_role() in ('admin','project_manager'));
drop policy if exists projects_update_manager on public.projects;
create policy projects_update_manager on public.projects for update to authenticated using(public.neas_can_manage_project(id)) with check(public.neas_can_manage_project(id));
drop policy if exists projects_delete_admin on public.projects;
create policy projects_delete_admin on public.projects for delete to authenticated using(public.neas_current_role()='admin');

drop policy if exists memberships_select_project on public.project_memberships;
create policy memberships_select_project on public.project_memberships for select to authenticated using(user_id=(select auth.uid()) or public.neas_can_manage_project(project_id));
drop policy if exists memberships_insert_manager on public.project_memberships;
create policy memberships_insert_manager on public.project_memberships for insert to authenticated with check(public.neas_can_manage_project(project_id));
drop policy if exists memberships_update_manager on public.project_memberships;
create policy memberships_update_manager on public.project_memberships for update to authenticated using(public.neas_can_manage_project(project_id)) with check(public.neas_can_manage_project(project_id));
drop policy if exists memberships_delete_manager on public.project_memberships;
create policy memberships_delete_manager on public.project_memberships for delete to authenticated using(public.neas_can_manage_project(project_id));

drop policy if exists activities_select_member on public.project_activities;
create policy activities_select_member on public.project_activities for select to authenticated using(public.neas_is_project_member(project_id));
drop policy if exists activities_insert_manager on public.project_activities;
create policy activities_insert_manager on public.project_activities for insert to authenticated with check(created_by=(select auth.uid()) and public.neas_can_manage_project(project_id));
drop policy if exists activities_update_manager on public.project_activities;
create policy activities_update_manager on public.project_activities for update to authenticated using(public.neas_can_manage_project(project_id)) with check(public.neas_can_manage_project(project_id));
drop policy if exists activities_delete_manager on public.project_activities;
create policy activities_delete_manager on public.project_activities for delete to authenticated using(public.neas_can_manage_project(project_id));

drop policy if exists reports_select_member on public.field_reports;
create policy reports_select_member on public.field_reports for select to authenticated using(public.neas_is_project_member(project_id));
drop policy if exists reports_insert_assigned on public.field_reports;
create policy reports_insert_assigned on public.field_reports for insert to authenticated with check(reported_by=(select auth.uid()) and public.neas_is_project_member(project_id) and exists(select 1 from public.project_activities a where a.id=activity_id and a.project_id=field_reports.project_id));
drop policy if exists reports_update_manager_or_author on public.field_reports;
create policy reports_update_manager_or_author on public.field_reports for update to authenticated using(reported_by=(select auth.uid()) or public.neas_can_manage_project(project_id)) with check(reported_by=(select auth.uid()) or public.neas_can_manage_project(project_id));
drop policy if exists reports_delete_manager on public.field_reports;
create policy reports_delete_manager on public.field_reports for delete to authenticated using(public.neas_can_manage_project(project_id));

drop policy if exists evidence_select_member on public.project_evidence;
create policy evidence_select_member on public.project_evidence for select to authenticated using(public.neas_is_project_member(project_id));
drop policy if exists evidence_insert_member on public.project_evidence;
create policy evidence_insert_member on public.project_evidence for insert to authenticated with check(uploaded_by=(select auth.uid()) and public.neas_is_project_member(project_id));
drop policy if exists evidence_delete_author_or_manager on public.project_evidence;
create policy evidence_delete_author_or_manager on public.project_evidence for delete to authenticated using(uploaded_by=(select auth.uid()) or public.neas_can_manage_project(project_id));

drop policy if exists estimates_select_member on public.estimates;
create policy estimates_select_member on public.estimates for select to authenticated using((project_id is null and created_by=(select auth.uid())) or (project_id is not null and public.neas_is_project_member(project_id)));
drop policy if exists estimates_insert_estimator on public.estimates;
create policy estimates_insert_estimator on public.estimates for insert to authenticated with check(created_by=(select auth.uid()) and public.neas_current_role() in ('admin','estimator','project_manager') and (project_id is null or public.neas_is_project_member(project_id)));
drop policy if exists estimates_update_estimator on public.estimates;
create policy estimates_update_estimator on public.estimates for update to authenticated using(created_by=(select auth.uid()) or (project_id is not null and public.neas_can_manage_project(project_id))) with check(created_by=(select auth.uid()) or (project_id is not null and public.neas_can_manage_project(project_id)));
drop policy if exists estimates_delete_manager on public.estimates;
create policy estimates_delete_manager on public.estimates for delete to authenticated using(public.neas_current_role()='admin' or (project_id is not null and public.neas_can_manage_project(project_id)));
