-- Owner bootstrap, approval-before-sign-in, and per-user module views.
reset role;
select set_config('request.jwt.claims', '', false);

-- 1. Owner e-mail while a Super Admin already exists: waits for approval like everyone else.
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000a9', 'owner.second@neas.test', '{}', now());
select test.check('bootstrap: settings hold the owner e-mail',
  (select value = 'info.nextedgeaccesssolutions@gmail.com' from neas.app_settings where key = 'bootstrap_admin_email'));

-- 2. Fresh system (no Super Admin): the owner becomes Super Admin only after verifying the e-mail.
do $$
declare before_verify text; after_verify text; other text;
begin
  begin
    update neas.profiles set global_role = 'staff' where global_role = 'super_admin';
    insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000b9', 'Info.NextEdgeAccessSolutions@gmail.com', '{}');
    insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values ('00000000-0000-0000-0000-0000000000c9', 'someone.else@neas.test', '{}', now());
    select status || '/' || global_role into before_verify from neas.profiles where id = '00000000-0000-0000-0000-0000000000b9';
    select status || '/' || global_role into other from neas.profiles where id = '00000000-0000-0000-0000-0000000000c9';
    update auth.users set email_confirmed_at = now() where id = '00000000-0000-0000-0000-0000000000b9';
    select status || '/' || global_role into after_verify from neas.profiles where id = '00000000-0000-0000-0000-0000000000b9';
    raise exception 'rollback-scenario';
  exception when raise_exception then null;
  end;
  perform test.check('bootstrap: owner stays pending until the e-mail is verified', before_verify = 'pending/staff', before_verify);
  perform test.check('bootstrap: verified owner becomes the first Super Admin', after_verify = 'active/super_admin', after_verify);
  perform test.check('bootstrap: any other sign-up still waits for approval', other = 'pending/staff', other);
end $$;
select test.check('bootstrap: scenario rolled back cleanly',
  (select count(*) >= 1 from neas.profiles where global_role = 'super_admin' and status = 'active')
  and not exists (select 1 from neas.profiles where id = '00000000-0000-0000-0000-0000000000b9'));

-- 3. Pending accounts cannot use the workspace even with a valid sign-in.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a9', false);
select test.check('approval: a signed-in but unapproved user has no workspace access',
  not neas.is_active_user() and (select count(*) = 0 from neas.projects));

-- 4. Module views
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
insert into neas.projects (id, code, name, status) values ('10000000-0000-0000-0000-000000000077', 'PRJ-2026-077', 'Views test', 'active');
reset role;
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000a7', 'pm.views@neas.test', '{"full_name":"PM Views"}', now());
set role authenticated;
select neas.admin_review_registration('00000000-0000-0000-0000-0000000000a7', true, null);
insert into neas.project_memberships (project_id, user_id, role, can_approve_reports) values
  ('10000000-0000-0000-0000-000000000077', '00000000-0000-0000-0000-0000000000a7', 'project_manager', true);
insert into neas.cost_settings (project_id) values ('10000000-0000-0000-0000-000000000077');
select neas.admin_set_views('00000000-0000-0000-0000-0000000000a7', array['overview', 'field_reports']);
select test.expect_error('views: unknown module names are refused',
  $$select neas.admin_set_views('00000000-0000-0000-0000-0000000000a7', array['payroll'])$$);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a7', false);
select test.check('views: user sees only the modules given', neas.can_view('field_reports') and not neas.can_view('estimating'));
select test.check('views: costing data is hidden without Estimating/Quotation', (select count(*) = 0 from neas.cost_settings where project_id = '10000000-0000-0000-0000-000000000077'));
select test.expect_error('views: cannot add BOQ lines without Estimating',
  $$insert into neas.boq_lines (project_id, description, qty, unit_cost) values ('10000000-0000-0000-0000-000000000077', 'X', 1, 1)$$);
select test.expect_error('views: cannot change the schedule without Project management',
  $$insert into neas.activities (project_id, name, start_date, end_date, weight) values ('10000000-0000-0000-0000-000000000077', 'A', '2026-10-01', '2026-10-02', 10)$$);
insert into neas.project_reports (project_id, report_date, actual_pct, notes) values ('10000000-0000-0000-0000-000000000077', '2026-10-18', 10, 'Allowed');
select test.check('views: allowed module still works (field report submitted)', (select count(*) = 1 from neas.project_reports where project_id = '10000000-0000-0000-0000-000000000077'));
select test.expect_error('views: users cannot change their own module views',
  $$select neas.admin_set_views('00000000-0000-0000-0000-0000000000a7', null)$$);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select neas.admin_set_views('00000000-0000-0000-0000-0000000000a7', null);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a7', false);
insert into neas.boq_lines (project_id, description, qty, unit_cost) values ('10000000-0000-0000-0000-000000000077', 'Rope access team', 2, 9000);
select test.check('views: restoring all modules restores costing access', (select count(*) = 1 from neas.boq_lines where project_id = '10000000-0000-0000-0000-000000000077'));
reset role;
select test.check('views: changes are in the audit log', (select count(*) = 2 from neas.audit_logs where action = 'account:views_changed'));

-- Field reports is always on, even for a user whose module list omits it.
reset role;
select set_config('request.jwt.claim.sub', '', false);
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values ('00000000-0000-0000-0000-0000000000f7', 'limited@neas.test', '{}', now());
update neas.profiles set status = 'active', approved_at = now(), allowed_views = array['overview'] where id = '00000000-0000-0000-0000-0000000000f7';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f7', false);
select test.check('views: field reports stays available when not in the module list',
  neas.can_view('field_reports') and not neas.can_view('site_evidence'));
reset role;
select set_config('request.jwt.claim.sub', '', false);
