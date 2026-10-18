-- Legacy import: builds a copy of the existing app's public.* tables (as in
-- nextedgeaccesssolutions-ra/neas-ai-project-intelligence) and checks the copy into neas.
reset role;
select set_config('request.jwt.claim.sub', '', false);

create table public.user_roles (user_id uuid primary key references auth.users(id), role text not null, active boolean not null default true);
create table public.projects (id uuid primary key default gen_random_uuid(), project_code text not null unique, name text not null,
  client_name text not null default '', location text not null default '', status text not null default 'planning',
  start_date date not null, end_date date not null, contract_value numeric(14,2) not null default 0,
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now());
create table public.project_memberships (project_id uuid references public.projects(id), user_id uuid references auth.users(id),
  project_role text not null default 'viewer', created_at timestamptz not null default now(), primary key (project_id, user_id));
create table public.project_activities (id uuid primary key default gen_random_uuid(), project_id uuid references public.projects(id),
  name text not null, start_date date not null, end_date date not null, weight numeric(5,2) not null, sort_order int not null default 0,
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now());
create table public.field_reports (id uuid primary key default gen_random_uuid(), project_id uuid references public.projects(id),
  activity_id uuid references public.project_activities(id), reported_by uuid references auth.users(id), report_date date not null,
  percent_complete numeric(5,2) not null, notes text not null default '', created_at timestamptz not null default now());
create table public.estimates (id uuid primary key default gen_random_uuid(), project_id uuid references public.projects(id),
  estimate_number text not null unique, record_type text not null, title text not null, client_name text not null default '',
  currency text not null default 'PHP', line_items jsonb not null default '[]', subtotal numeric(14,2) not null default 0,
  markup_percent numeric(6,2) not null default 0, vat_percent numeric(6,2) not null default 12, total numeric(14,2) not null default 0,
  status text not null default 'draft', created_by uuid not null references auth.users(id), created_at timestamptz not null default now());

-- legacy users exist before the neas trigger: insert with the trigger disabled
alter table auth.users disable trigger neas_on_auth_user_created;
insert into auth.users (id, email, email_confirmed_at) values
  ('10000000-0000-0000-0000-0000000000a1', 'legacy.admin@neas.test', now()),
  ('10000000-0000-0000-0000-0000000000a2', 'legacy.pm@neas.test', now()),
  ('10000000-0000-0000-0000-0000000000a3', 'legacy.viewer@neas.test', now()),
  ('10000000-0000-0000-0000-0000000000a4', 'legacy.off@neas.test', now());
alter table auth.users enable trigger neas_on_auth_user_created;
insert into public.user_roles values
  ('10000000-0000-0000-0000-0000000000a1', 'admin', true), ('10000000-0000-0000-0000-0000000000a2', 'project_manager', true),
  ('10000000-0000-0000-0000-0000000000a3', 'viewer', true), ('10000000-0000-0000-0000-0000000000a4', 'technician', false);
insert into public.projects (id, project_code, name, client_name, location, status, start_date, end_date, contract_value, created_by) values
  ('20000000-0000-0000-0000-000000000001', 'NEAS-Q-2026-001', 'Legacy facade job', 'Client A', 'Makati', 'active', '2026-10-16', '2026-10-23', 100000, '10000000-0000-0000-0000-0000000000a1'),
  ('20000000-0000-0000-0000-000000000002', 'x', 'Short code job', '', '', 'on_hold', '2026-11-01', '2026-11-30', 0, '10000000-0000-0000-0000-0000000000a2');
insert into public.project_memberships values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000a2', 'project_manager', now()),
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000a3', 'viewer', now());
insert into public.project_activities (id, project_id, name, start_date, end_date, weight, created_by) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Rope access cleaning', '2026-10-16', '2026-10-23', 100, '10000000-0000-0000-0000-0000000000a1'),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'Mobilisation', '2026-11-01', '2026-11-02', 0, '10000000-0000-0000-0000-0000000000a2');
insert into public.field_reports (project_id, activity_id, reported_by, report_date, percent_complete, notes) values
  ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-0000000000a2', '2026-10-17', 30, 'Drop 1 done');
insert into public.estimates (project_id, estimate_number, record_type, title, line_items, markup_percent, vat_percent, created_by) values
  ('20000000-0000-0000-0000-000000000001', 'NEAS-Q-2026-001', 'quotation', 'Facade cleaning',
   '[{"description":"Facade cleaning","qty":1000,"unit":"sqm","rate":100,"amount":100000},{"description":"bad","qty":"abc","rate":1}]', 15, 12, '10000000-0000-0000-0000-0000000000a1');

create temp table legacy_before as select (select count(*) from public.projects) p, (select count(*) from public.field_reports) r, (select count(*) from public.estimates) e;

set role authenticated;
select test.expect_error('legacy import: browser sessions cannot run it', 'select neas.import_legacy_public()');
reset role;
insert into test.vars values ('import1', (select neas.import_legacy_public()::text));
insert into test.vars values ('import2', (select neas.import_legacy_public()::text));

select test.check('legacy import: first run copies every record',
  (select v::jsonb->>'projects' = '2' and v::jsonb->>'activities' = '2' and v::jsonb->>'reports' = '1' and v::jsonb->>'boq_lines' = '1' and v::jsonb->>'quotations' = '1' from test.vars where k = 'import1'), test.v('import1'));
select test.check('legacy import: re-running adds nothing (idempotent)',
  (select v::jsonb->>'projects' = '0' and v::jsonb->>'profiles' = '0' and v::jsonb->>'reports' = '0' and v::jsonb->>'boq_lines' = '0' from test.vars where k = 'import2'), test.v('import2'));
select test.check('legacy import: old app tables are untouched',
  (select p = (select count(*) from public.projects) and r = (select count(*) from public.field_reports) and e = (select count(*) from public.estimates) from legacy_before));
select test.check('legacy import: roles map to Super Admin / active / pending / suspended',
  (select global_role = 'super_admin' and status = 'active' from neas.profiles where email = 'legacy.admin@neas.test')
  and (select global_role = 'staff' and status = 'active' from neas.profiles where email = 'legacy.pm@neas.test')
  and (select status = 'pending' from neas.profiles where email = 'legacy.viewer@neas.test')
  and (select status = 'suspended' from neas.profiles where email = 'legacy.off@neas.test'));
select test.check('legacy import: unreviewed viewers appear in Pending approvals',
  (select count(*) = 1 from neas.registration_requests where email = 'legacy.viewer@neas.test'));
select test.check('legacy import: project codes become URL-safe, original kept as reference',
  (select code = 'NEAS-Q-2026-001' and status = 'active' from neas.projects where id = '20000000-0000-0000-0000-000000000001')
  and (select code like 'PRJ-%' and reference_no = 'x' and status = 'suspended' from neas.projects where id = '20000000-0000-0000-0000-000000000002'));
select test.check('legacy import: memberships map (PM manages, viewer is employee)',
  (select role = 'project_manager' and can_approve_reports from neas.project_memberships where user_id = '10000000-0000-0000-0000-0000000000a2')
  and (select role = 'employee' and not can_approve_reports from neas.project_memberships where user_id = '10000000-0000-0000-0000-0000000000a3'));
select test.check('legacy import: progress, BOQ and pricing carry over',
  (select actual_pct = 30 and status = 'submitted' from neas.project_reports where activity_id = '30000000-0000-0000-0000-000000000001')
  and (select qty = 1000 and unit_cost = 100 from neas.boq_lines where project_id = '20000000-0000-0000-0000-000000000001')
  and (select markup_pct = 15 and vat_pct = 12 and overhead_pct = 0 from neas.cost_settings where project_id = '20000000-0000-0000-0000-000000000001')
  and (select weight = 0.01 from neas.activities where id = '30000000-0000-0000-0000-000000000002'));
select test.check('legacy import: logged in the audit trail', (select count(*) = 2 from neas.audit_logs where action = 'system:legacy_import'));
