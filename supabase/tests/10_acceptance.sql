-- NEAS platform acceptance tests (database layer). Run by scripts/db-test.sh on a throwaway
-- PostgreSQL 16 cluster with the Supabase stub. Each check records PASS/FAIL in test.results.
\set QUIET on
\pset pager off
create schema test;
create table test.results (n serial, name text, ok boolean, detail text);
grant usage on schema test to authenticated, service_role, anon;
grant insert, select on test.results to authenticated, service_role, anon;
grant usage on sequence test.results_n_seq to authenticated, service_role, anon;
create table test.vars (k text primary key, v text);
grant select, insert, update on test.vars to authenticated, service_role, anon;

create function test.check(p_name text, p_ok boolean, p_detail text default null) returns void
language sql security definer as $$ insert into test.results (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail) $$;
grant execute on function test.check(text, boolean, text) to authenticated, service_role, anon;

-- runs SQL as the CURRENT role and passes if it raises
create function test.expect_error(p_name text, p_sql text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
    perform test.check(p_name, false, 'no error raised');
  exception when others then
    perform test.check(p_name, true, sqlerrm);
  end;
end $$;
grant execute on function test.expect_error(text, text) to authenticated, service_role, anon;

create function test.v(p text) returns text language sql security definer as $$ select v from test.vars where k = p $$;
grant execute on function test.v(text) to authenticated, service_role, anon;
create function test.setv(p text, val text) returns void language sql security definer as $$
  insert into test.vars values (p, val) on conflict (k) do update set v = excluded.v $$;
grant execute on function test.setv(text, text) to authenticated, service_role, anon;

-- ---------------------------------------------------------------------------
-- Fixtures (as the database owner)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@neas.test', '{"full_name":"Super Admin"}', now()),
  ('00000000-0000-0000-0000-0000000000b1', 'pm.a@neas.test', '{"full_name":"PM Alpha"}', now()),
  ('00000000-0000-0000-0000-0000000000c1', 'tech.a@neas.test', '{"full_name":"Tech Alpha"}', now()),
  ('00000000-0000-0000-0000-0000000000d1', 'tech.b@neas.test', '{"full_name":"Tech Bravo"}', now()),
  ('00000000-0000-0000-0000-0000000000e1', 'new.hire@neas.test', '{"full_name":"New Hire"}', null);

-- bootstrap: the first Super Admin is promoted by the database owner (documented in the manual)
update neas.profiles set global_role = 'super_admin', status = 'active', approved_at = now() where email = 'admin@neas.test';

select test.check('registration: new sign-ups start as pending', (select count(*) = 4 from neas.profiles where status = 'pending'));
select test.check('registration: each sign-up creates a registration request', (select count(*) = (select count(*) from auth.users) from neas.registration_requests where status = 'pending'));

-- ---------------------------------------------------------------------------
-- Pending accounts have no access
-- ---------------------------------------------------------------------------
insert into neas.projects (id, code, name, status, contract_value, client_portal_enabled) values
  ('10000000-0000-0000-0000-00000000000a', 'PRJ-2026-001', 'Facade Cleaning Alpha', 'active', 1250000, false),
  ('10000000-0000-0000-0000-00000000000b', 'PRJ-2026-002', 'Solar Panel Wash Bravo', 'active', 480000, false);
insert into neas.project_memberships (project_id, user_id, role) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000b1', 'project_manager'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c1', 'employee'),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000d1', 'employee');
insert into neas.activities (id, project_id, name, start_date, end_date, weight, is_milestone) values
  ('20000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'Mobilization', '2026-10-01', '2026-10-04', 10, true),
  ('20000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', 'Rope access cleaning', '2026-10-05', '2026-10-22', 90, false),
  ('20000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000b', 'Panel washing', '2026-10-10', '2026-10-20', 100, false);
insert into neas.boq_lines (project_id, description, category, unit, qty, unit_cost) values
  ('10000000-0000-0000-0000-00000000000a', 'Rope access team', 'Labor', 'day', 18, 9500);

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
select test.check('pending: unapproved user sees no projects', (select count(*) = 0 from neas.projects));
select test.expect_error('pending: unapproved user cannot file a report',
  $$insert into neas.project_reports (project_id, activity_id, report_date, actual_pct) values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', '2026-10-03', 50)$$);
select test.expect_error('admin functions: non-admin cannot approve registrations',
  $$select neas.admin_review_registration('00000000-0000-0000-0000-0000000000c1', true)$$);

-- Super Admin approves three accounts and rejects none yet
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select neas.admin_review_registration('00000000-0000-0000-0000-0000000000b1', true);
select neas.admin_review_registration('00000000-0000-0000-0000-0000000000c1', true);
select neas.admin_review_registration('00000000-0000-0000-0000-0000000000d1', true);
select neas.admin_review_registration('00000000-0000-0000-0000-0000000000e1', true);
select test.check('approval: admin approval activates accounts', (select count(*) = 5 from neas.profiles where status = 'active'));

-- unverified e-mail stays locked even though approved
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', false);
select test.check('verification: approved but unverified e-mail has no access', not neas.is_active_user());
reset role;
update auth.users set email_confirmed_at = now() where id = '00000000-0000-0000-0000-0000000000e1';
set role authenticated;
select test.check('verification: verifying the e-mail completes activation', neas.is_active_user());

-- ---------------------------------------------------------------------------
-- Project isolation
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
select test.check('isolation: employee A sees only project A', (select array_agg(code) = array['PRJ-2026-001'] from neas.projects));
select test.check('isolation: employee A cannot read project B activities', (select count(*) = 0 from neas.activities where project_id = '10000000-0000-0000-0000-00000000000b'));
select test.expect_error('isolation: employee A cannot file a report in project B',
  $$insert into neas.project_reports (project_id, activity_id, report_date, actual_pct) values ('10000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-0000000000b1', '2026-10-12', 10)$$);
update neas.activities set weight = 1 where project_id = '10000000-0000-0000-0000-00000000000b';
reset role;
select test.check('isolation: employee A update on project B changed nothing', (select weight = 100 from neas.activities where id = '20000000-0000-0000-0000-0000000000b1'));
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
select test.check('confidential: employee cannot read BOQ of own project', (select count(*) = 0 from neas.boq_lines));
select test.expect_error('confidential: employee cannot add BOQ lines',
  $$insert into neas.boq_lines (project_id, description, qty, unit_cost) values ('10000000-0000-0000-0000-00000000000a', 'x', 1, 1)$$);
select test.check('confidential: employee cannot read audit log', (select count(*) = 0 from neas.audit_logs));
select test.expect_error('confidential: employee cannot change own role', $$update neas.profiles set global_role = 'super_admin' where id = auth.uid()$$);

-- employee files a report; cannot approve it
insert into neas.project_reports (id, project_id, activity_id, report_date, actual_pct, notes)
  values ('30000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', '2026-10-03', 60, 'Anchors installed');
select test.check('reports: employee can file a report on own project', (select count(*) = 1 from neas.project_reports));
select test.expect_error('reports: employee cannot approve own report',
  $$update neas.project_reports set status = 'approved' where id = '30000000-0000-0000-0000-0000000000a1'$$);

-- manager of B? none. Employee B cannot see A's report
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);
select test.check('isolation: employee B cannot see project A reports', (select count(*) = 0 from neas.project_reports));
select test.check('isolation: changing the project id in a query does not bypass RLS',
  (select count(*) = 0 from neas.project_reports where project_id = '10000000-0000-0000-0000-00000000000a'));

-- manager A approves; cannot touch project B
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
update neas.project_reports set status = 'approved', client_visible = true, review_note = 'OK' where id = '30000000-0000-0000-0000-0000000000a1';
select test.check('reports: manager approves report on own project', (select status = 'approved' and reviewed_by = '00000000-0000-0000-0000-0000000000b1' from neas.project_reports where id = '30000000-0000-0000-0000-0000000000a1'));
select test.check('confidential: manager can read own project BOQ', (select count(*) = 1 from neas.boq_lines));
select test.check('isolation: manager A cannot see project B', (select count(*) = 0 from neas.projects where code = 'PRJ-2026-002'));
select test.expect_error('isolation: manager A cannot add himself to project B',
  $$insert into neas.project_memberships (project_id, user_id, role) values ('10000000-0000-0000-0000-00000000000b', auth.uid(), 'project_manager')$$);
select test.expect_error('roles: manager cannot add another manager',
  $$insert into neas.project_memberships (project_id, user_id, role) values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000e1', 'project_manager')$$);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
select test.expect_error('reports: employee cannot edit an approved report',
  $$update neas.project_reports set notes = 'changed' where id = '30000000-0000-0000-0000-0000000000a1'$$);

-- ---------------------------------------------------------------------------
-- Offline sync: idempotency, conflicts, authorization
-- ---------------------------------------------------------------------------
select test.setv('op1', (neas.apply_operation('{"op_id":"40000000-0000-0000-0000-000000000001","entity":"project_reports","op":"upsert","record_id":"30000000-0000-0000-0000-0000000000a2","project_id":"10000000-0000-0000-0000-00000000000a","payload":{"activity_id":"20000000-0000-0000-0000-0000000000a2","report_date":"2026-10-06","actual_pct":15,"notes":"Offline report","status":"submitted"}}'::jsonb))::text);
select test.check('sync: offline report is applied', test.v('op1')::jsonb ->> 'status' = 'applied', test.v('op1'));
select test.setv('op1b', (neas.apply_operation('{"op_id":"40000000-0000-0000-0000-000000000001","entity":"project_reports","op":"upsert","record_id":"30000000-0000-0000-0000-0000000000a2","project_id":"10000000-0000-0000-0000-00000000000a","payload":{"activity_id":"20000000-0000-0000-0000-0000000000a2","report_date":"2026-10-06","actual_pct":15,"notes":"Offline report","status":"submitted"}}'::jsonb))::text);
select test.check('sync: retrying the same operation returns the stored result', (test.v('op1b')::jsonb ->> 'duplicate')::boolean);
select test.check('sync: retry did not create a duplicate row', (select count(*) = 1 from neas.project_reports where id = '30000000-0000-0000-0000-0000000000a2'));
select test.setv('op2', (neas.apply_operation('{"op_id":"40000000-0000-0000-0000-000000000002","entity":"project_reports","op":"upsert","record_id":"30000000-0000-0000-0000-0000000000a2","project_id":"10000000-0000-0000-0000-00000000000a","base_version":1,"payload":{"actual_pct":25}}'::jsonb))::text);
select test.check('sync: update with current version applies and bumps version', test.v('op2')::jsonb -> 'record' ->> 'version' = '2', test.v('op2'));
select test.setv('op3', (neas.apply_operation('{"op_id":"40000000-0000-0000-0000-000000000003","entity":"project_reports","op":"upsert","record_id":"30000000-0000-0000-0000-0000000000a2","project_id":"10000000-0000-0000-0000-00000000000a","base_version":1,"payload":{"actual_pct":99}}'::jsonb))::text);
select test.check('sync: stale version is reported as a conflict', test.v('op3')::jsonb ->> 'status' = 'conflict', test.v('op3'));
select test.check('sync: conflict did not overwrite the newer server value', (select actual_pct = 25 from neas.project_reports where id = '30000000-0000-0000-0000-0000000000a2'));
select test.setv('op4', (neas.apply_operation('{"op_id":"40000000-0000-0000-0000-000000000004","entity":"project_reports","op":"upsert","record_id":"30000000-0000-0000-0000-0000000000b9","project_id":"10000000-0000-0000-0000-00000000000b","payload":{"report_date":"2026-10-12","actual_pct":10}}'::jsonb))::text);
select test.check('sync: operation for another project is rejected', test.v('op4')::jsonb ->> 'status' = 'rejected', test.v('op4'));
select test.setv('op5', (neas.apply_operation('{"op_id":"40000000-0000-0000-0000-000000000005","entity":"boq_lines","op":"upsert","record_id":"50000000-0000-0000-0000-000000000001","project_id":"10000000-0000-0000-0000-00000000000a","payload":{"description":"Sneaky","qty":1,"unit_cost":1}}'::jsonb))::text);
select test.check('sync: employee cannot write confidential BOQ through sync', test.v('op5')::jsonb ->> 'status' = 'rejected', test.v('op5'));
select test.setv('op6', (neas.apply_operation('{"op_id":"40000000-0000-0000-0000-000000000006","entity":"project_reports","op":"upsert","record_id":"30000000-0000-0000-0000-0000000000a3","project_id":"10000000-0000-0000-0000-00000000000a","payload":{"report_date":"2026-10-07","actual_pct":20,"status":"approved"}}'::jsonb))::text);
select test.check('sync: employee cannot self-approve through sync', test.v('op6')::jsonb ->> 'status' = 'rejected', test.v('op6'));

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------
reset role;
insert into storage.buckets values ('neas-project-files', 'neas-project-files', false) on conflict do nothing;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
insert into storage.objects (bucket_id, name) values ('neas-project-files', '10000000-0000-0000-0000-00000000000a/photo1.jpg');
select test.check('storage: employee uploads into own project folder', (select count(*) = 1 from storage.objects));
select test.expect_error('storage: employee cannot upload into another project folder',
  $$insert into storage.objects (bucket_id, name) values ('neas-project-files', '10000000-0000-0000-0000-00000000000b/x.jpg')$$);
select test.expect_error('storage: malformed paths are refused',
  $$insert into storage.objects (bucket_id, name) values ('neas-project-files', '../../etc/passwd')$$);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);
select test.check('storage: employee B cannot list project A files', (select count(*) = 0 from storage.objects));

-- ---------------------------------------------------------------------------
-- Membership removal and suspension
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
delete from neas.project_memberships where project_id = '10000000-0000-0000-0000-00000000000b' and user_id = '00000000-0000-0000-0000-0000000000d1';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);
select test.check('membership: removing membership blocks access', (select count(*) = 0 from neas.projects));

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select neas.admin_set_user_status('00000000-0000-0000-0000-0000000000c1', 'suspended', 'Left the company');
select test.expect_error('suspension: admin cannot suspend themselves',
  $$select neas.admin_set_user_status('00000000-0000-0000-0000-0000000000a1', 'suspended')$$);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
select test.check('suspension: suspended user loses all project access', (select count(*) = 0 from neas.projects) and (select count(*) = 0 from neas.project_reports));
select test.setv('op7', (neas.apply_operation('{"op_id":"40000000-0000-0000-0000-000000000007","entity":"project_reports","op":"upsert","record_id":"30000000-0000-0000-0000-0000000000a4","project_id":"10000000-0000-0000-0000-00000000000a","payload":{"report_date":"2026-10-08","actual_pct":30}}'::jsonb))::text);
select test.check('suspension: queued offline data cannot sync after suspension', test.v('op7')::jsonb ->> 'status' = 'rejected', test.v('op7'));

-- suspending a project closes it to members but not to the Super Admin
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
update neas.projects set status = 'suspended' where code = 'PRJ-2026-001';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
select test.check('project status: suspended project is closed to its manager', (select count(*) = 0 from neas.projects));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select test.check('project status: Super Admin still sees the suspended project', (select count(*) = 2 from neas.projects));
update neas.projects set status = 'active' where code = 'PRJ-2026-001';

-- ---------------------------------------------------------------------------
-- Client portal
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
select test.expect_error('client: manager cannot create client passcodes',
  $$select neas.admin_create_client_passcode('10000000-0000-0000-0000-00000000000a')$$);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select test.setv('code1', neas.admin_create_client_passcode('10000000-0000-0000-0000-00000000000a', 'Owner rep', null, false));
select test.check('client: passcode is 12 characters in groups of four', test.v('code1') ~ '^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$', test.v('code1'));
select test.expect_error('client: admins cannot read passcode hashes', $$select passcode_hash from neas.client_access_credentials$$);
select test.check('client: credential is listed for admins without the hash', (select count(*) = 1 from (select id, label from neas.client_access_credentials) c));
update neas.approved_client_content set show_progress = true, show_reports = true, show_milestones = true where project_id = '10000000-0000-0000-0000-00000000000a';
select test.expect_error('client: signed-in users cannot call the client login function',
  $$select * from neas.client_login('PRJ-2026-001', 'AAAA-BBBB-CCCC', 'ip')$$);

reset role;
set role service_role;
select test.check('client: portal disabled → passcode rejected', (select not ok from neas.client_login('PRJ-2026-001', test.v('code1'), 'ip-1')));
reset role;
update neas.projects set client_portal_enabled = true where code = 'PRJ-2026-001';
set role service_role;
select test.check('client: wrong passcode rejected with a generic message', (select not ok and error = 'Invalid project code or passcode' from neas.client_login('PRJ-2026-001', 'WRON-GWRO-NGXX', 'ip-1')));
select test.check('client: correct passcode for the wrong project rejected', (select not ok from neas.client_login('PRJ-2026-002', test.v('code1'), 'ip-1')));
select test.setv('tok1', (select session_token from neas.client_login('prj-2026-001', lower(replace(test.v('code1'), '-', ' ')), 'ip-1') where ok));
select test.check('client: valid passcode issues a session (code and spacing tolerant)', length(test.v('tok1')) = 64);
select test.setv('snap1', neas.client_snapshot(test.v('tok1'))::text);
select test.check('client: snapshot shows the right project', test.v('snap1')::jsonb -> 'project' ->> 'code' = 'PRJ-2026-001');
select test.check('client: snapshot hides contract value, BOQ and quotations',
  not (test.v('snap1') ilike '%contract%' or test.v('snap1') ilike '%boq%' or test.v('snap1') ilike '%unit_cost%' or test.v('snap1') ilike '%quotation%' or test.v('snap1') ilike '%9500%'));
select test.check('client: snapshot hides staff identities', not (test.v('snap1') ilike '%@neas.test%' or test.v('snap1') ilike '%submitted_by%' or test.v('snap1') ilike '%Tech Alpha%'));
select test.check('client: only approved, client-visible reports are shown',
  jsonb_array_length(test.v('snap1')::jsonb -> 'reports') = 1 and test.v('snap1') like '%Anchors installed%' and test.v('snap1') not like '%Offline report%');
select test.check('client: photos stay hidden until enabled', not (test.v('snap1')::jsonb ? 'files'));
select test.expect_error('client: a made-up session token is rejected', $$select neas.client_snapshot(repeat('a', 64))$$);

-- rotation invalidates the old passcode and its sessions
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select test.setv('code2', neas.admin_create_client_passcode('10000000-0000-0000-0000-00000000000a', 'Rotated', null, true));
reset role;
set role service_role;
select test.expect_error('client: rotation ends existing sessions', format($$select neas.client_snapshot(%L)$$, test.v('tok1')));
select test.check('client: rotation invalidates the old passcode', (select not ok from neas.client_login('PRJ-2026-001', test.v('code1'), 'ip-2')));
select test.check('client: new passcode works', (select ok from neas.client_login('PRJ-2026-001', test.v('code2'), 'ip-2')));

-- expiry
reset role;
update neas.client_access_credentials set expires_at = now() - interval '1 minute' where revoked_at is null;
set role service_role;
select test.check('client: expired passcode rejected', (select not ok from neas.client_login('PRJ-2026-001', test.v('code2'), 'ip-3')));
reset role;
update neas.client_access_credentials set expires_at = null where revoked_at is null;

-- throttling: 5 failures from one address lock it out for 15 minutes, even with the right code
set role service_role;
do $$ begin for i in 1..5 loop perform neas.client_login('PRJ-2026-001', 'BAD0-BAD0-BAD0', 'ip-9'); end loop; end $$;
select test.check('client: throttled after 5 failed attempts, even with the right passcode', (select not ok and error like 'Too many attempts%' from neas.client_login('PRJ-2026-001', test.v('code2'), 'ip-9')));
select test.check('client: throttling is per address (others can still sign in)', (select ok from neas.client_login('PRJ-2026-001', test.v('code2'), 'ip-10')));
reset role;

-- ---------------------------------------------------------------------------
-- Invitations and audit
-- ---------------------------------------------------------------------------
insert into neas.project_invitations (email, full_name, project_id, role, invited_by)
  values ('invitee@neas.test', 'Invited Inspector', '10000000-0000-0000-0000-00000000000a', 'employee', '00000000-0000-0000-0000-0000000000a1');
insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-0000-0000-0000000000f1', 'Invitee@NEAS.test', now());
select test.check('invitation: invited user is active with project access on first sign-in',
  (select status = 'active' from neas.profiles where id = '00000000-0000-0000-0000-0000000000f1')
  and (select count(*) = 1 from neas.project_memberships where user_id = '00000000-0000-0000-0000-0000000000f1'));
select test.check('invitation: invitation cannot be reused', (select status = 'accepted' from neas.project_invitations where lower(email) = 'invitee@neas.test'));

select test.check('audit: approvals, suspensions and client logins are logged',
  (select count(*) filter (where action = 'update:profiles') >= 5 and count(*) filter (where action = 'client:login') >= 2 and count(*) filter (where action = 'client:login_failed') >= 5 from neas.audit_logs));
select test.check('audit: passcode hashes never reach the audit log', (select count(*) = 0 from neas.audit_logs where details::text like '%$2a$%' or details::text ilike '%passcode_hash%'));

\ir 20_legacy_import.sql
\ir 30_user_admin.sql
\ir 40_access_control.sql
\ir 50_one_time_codes.sql
\ir 60_recovery.sql
\ir 70_user_edit_delete.sql
\ir 80_site_evidence_gps.sql
\ir 90_schedule_engine.sql
\ir 91_activity_stops.sql
\ir 92_evidence_locations.sql
\ir 93_project_cover_reports.sql

-- ---------------------------------------------------------------------------
\set QUIET off
\echo
select case when ok then 'PASS' else 'FAIL' end as result, name, case when ok then '' else coalesce(detail, '') end as detail from test.results order by n;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from test.results;
