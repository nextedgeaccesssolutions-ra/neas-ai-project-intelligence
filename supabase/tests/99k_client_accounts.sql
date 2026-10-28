-- A client account reads only what is shared with the client on its projects, and writes nothing.
-- (Tech Alpha is suspended by an earlier test: activate for this file, restore at the end.)
select test.setv('cl_status', (select status::text from neas.profiles where id = '00000000-0000-0000-0000-0000000000c1'));
update neas.profiles set status = 'active' where id = '00000000-0000-0000-0000-0000000000c1';
select test.setv('cl_shared', (select count(*)::text from neas.project_reports
  where project_id = '10000000-0000-0000-0000-00000000000a' and status = 'approved' and client_visible and deleted_at is null));
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
select test.check('client: an active employee is a staff member first', neas.is_member('10000000-0000-0000-0000-00000000000a'));
select test.expect_error('client: only a Super Admin can make a client account',
  $$select neas.admin_set_client('00000000-0000-0000-0000-0000000000c1', true)$$);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select test.expect_error('client: a Super Admin cannot become a client account',
  $$select neas.admin_set_client('00000000-0000-0000-0000-0000000000a1', true)$$);
select neas.admin_set_client('00000000-0000-0000-0000-0000000000c1', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
select test.check('client: sees their project', exists (select 1 from neas.projects where id = '10000000-0000-0000-0000-00000000000a'));
select test.check('client: sees only approved, client-shared reports',
  (select count(*)::text from neas.project_reports where project_id = '10000000-0000-0000-0000-00000000000a') = test.v('cl_shared'));
select test.check('client: sees no hidden photos', not exists (select 1 from neas.report_attachments where not client_visible));
select test.check('client: sees only client-visible activities', not exists (select 1 from neas.activities where not client_visible));
select test.check('client: sees no costing', not exists (select 1 from neas.boq_lines) and not exists (select 1 from neas.cost_settings));
select test.check('client: is not a staff member', not neas.is_member('10000000-0000-0000-0000-00000000000a'));
select test.expect_error('client: cannot submit a report',
  $$insert into neas.project_reports (project_id, activity_id, report_date, actual_pct) values ('10000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-0000000000a1', '2026-10-20', 60)$$);
select test.expect_error('client: cannot add an activity',
  $$insert into neas.activities (project_id, name, start_date, end_date, weight) values ('10000000-0000-0000-0000-00000000000a', 'X', '2026-10-01', '2026-10-02', 1)$$);
select test.check('client: sees nothing of other projects', not exists (select 1 from neas.projects where id = '10000000-0000-0000-0000-00000000000b'));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select neas.admin_set_client('00000000-0000-0000-0000-0000000000c1', false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
select test.check('client: made staff again, the employee is a member again', neas.is_member('10000000-0000-0000-0000-00000000000a'));
reset role;
update neas.profiles set status = test.v('cl_status')::neas.account_status where id = '00000000-0000-0000-0000-0000000000c1';
-- choosing modules by hand turns a client back into staff
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select neas.admin_set_client('00000000-0000-0000-0000-0000000000b1', true);
select neas.admin_set_views('00000000-0000-0000-0000-0000000000b1', null);
select test.check('client: setting modules by hand makes the account staff', not (select is_client from neas.profiles where id = '00000000-0000-0000-0000-0000000000b1'));
reset role;
update neas.project_memberships set role = 'project_manager', can_approve_reports = true
  where user_id = '00000000-0000-0000-0000-0000000000b1' and project_id = '10000000-0000-0000-0000-00000000000a';
