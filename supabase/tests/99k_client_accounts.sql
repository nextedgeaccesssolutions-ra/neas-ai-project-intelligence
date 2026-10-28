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
-- Report templates: a client sees only final template reports of their project, never the library or drafts
update neas.profiles set status = 'active' where id = '00000000-0000-0000-0000-0000000000c1';
insert into neas.report_templates (project_id, name, definition) values (null, 'Library test', '{"sections":[]}');
insert into neas.template_reports (project_id, title, definition, status, created_by) values
  ('10000000-0000-0000-0000-00000000000a', 'Client final', '{"sections":[]}', 'final', '00000000-0000-0000-0000-0000000000b1'),
  ('10000000-0000-0000-0000-00000000000a', 'Client draft', '{"sections":[]}', 'draft', '00000000-0000-0000-0000-0000000000b1');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select neas.admin_set_client('00000000-0000-0000-0000-0000000000c1', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
select test.check('client: no template library', not exists (select 1 from neas.report_templates where project_id is null));
select test.check('client: sees the final template report', exists (select 1 from neas.template_reports where title = 'Client final'));
select test.check('client: no draft template reports', not exists (select 1 from neas.template_reports where status = 'draft'));
select test.check('client: Project register is not a client module', not (select 'projects' = any (allowed_views) from neas.profiles where id = auth.uid()));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select neas.admin_set_client('00000000-0000-0000-0000-0000000000c1', false);
reset role;
update neas.profiles set status = test.v('cl_status')::neas.account_status where id = '00000000-0000-0000-0000-0000000000c1';
-- a Super Admin can give a client more modules; the account stays a client (view only)
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select neas.admin_set_client('00000000-0000-0000-0000-0000000000d1', true);
select neas.admin_set_client_views('00000000-0000-0000-0000-0000000000d1', array['overview', 'projects', 'estimating']);
select test.check('client: extra modules keep the client flag',
  (select is_client and 'estimating' = any (allowed_views) from neas.profiles where id = '00000000-0000-0000-0000-0000000000d1'));
select test.expect_error('client: module choice for clients only works on client accounts',
  $$select neas.admin_set_client_views('00000000-0000-0000-0000-0000000000b1', array['overview'])$$);
select neas.admin_set_client('00000000-0000-0000-0000-0000000000d1', false);
reset role;
-- Delete forever frees the e-mail and username of a deleted account
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select test.expect_error('delete forever: only an already-deleted account',
  $$select neas.admin_release_deleted_user('00000000-0000-0000-0000-0000000000b1')$$);
reset role;
update neas.profiles set deleted_at = now(), status = 'suspended' where id = '00000000-0000-0000-0000-0000000000e1';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select neas.admin_release_deleted_user('00000000-0000-0000-0000-0000000000e1');
select test.check('delete forever: the e-mail is free again',
  not exists (select 1 from neas.profiles where lower(email) = 'new.hire@neas.test'));
reset role;
