-- Super Admin edit and (reversible) delete of user accounts.
reset role;
select set_config('request.jwt.claims', '', false);
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000e7', 'leaver@neas.test', '{"full_name":"Leaving Tech"}', now());
update neas.profiles set status = 'active', approved_at = now() where id = '00000000-0000-0000-0000-0000000000e7';
insert into neas.project_memberships (project_id, user_id, role) values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000e7', 'employee');
insert into neas.project_reports (id, project_id, report_date, notes, submitted_by) values
  ('30000000-0000-0000-0000-0000000000e7', '10000000-0000-0000-0000-00000000000a', '2026-10-21', 'Report by leaver', '00000000-0000-0000-0000-0000000000e7');

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
select test.expect_error('users: staff cannot edit another profile',
  $$select neas.admin_update_profile('00000000-0000-0000-0000-0000000000e7', 'Hacked', '')$$);
select test.expect_error('users: staff cannot delete an account',
  $$select neas.admin_delete_user('00000000-0000-0000-0000-0000000000e7', null)$$);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select neas.admin_update_profile('00000000-0000-0000-0000-0000000000e7', '  Leaving   Technician ', 'Rope access tech');
select test.check('users: admin edits name and job title (whitespace tidied)',
  (select full_name = 'Leaving Technician' and job_title = 'Rope access tech' from neas.profiles where id = '00000000-0000-0000-0000-0000000000e7'));
select test.expect_error('users: a one-letter name is refused',
  $$select neas.admin_update_profile('00000000-0000-0000-0000-0000000000e7', 'X', '')$$);
select test.expect_error('users: admin cannot delete their own account',
  $$select neas.admin_delete_user('00000000-0000-0000-0000-0000000000a1', null)$$);

select neas.admin_delete_user('00000000-0000-0000-0000-0000000000e7', 'Left the company');
reset role;
select set_config('request.jwt.claim.sub', '', false);
select test.check('users: deleted account is blocked and marked deleted',
  (select status = 'suspended' and deleted_at is not null from neas.profiles where id = '00000000-0000-0000-0000-0000000000e7'));
select test.check('users: deleted account loses project access',
  not exists (select 1 from neas.project_memberships where user_id = '00000000-0000-0000-0000-0000000000e7'));
select test.check('users: their field reports and authorship are kept',
  exists (select 1 from neas.project_reports where id = '30000000-0000-0000-0000-0000000000e7' and submitted_by = '00000000-0000-0000-0000-0000000000e7' and deleted_at is null));
select test.check('users: edit and delete are in the audit log',
  (select count(*) filter (where action = 'account:deleted') = 1 and count(*) filter (where action = 'update:profiles' and details ? 'full_name') >= 1
   from neas.audit_logs where target_id = '00000000-0000-0000-0000-0000000000e7'));

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select neas.admin_set_user_status('00000000-0000-0000-0000-0000000000e7', 'active', null);
select test.check('users: activating a deleted account restores it',
  (select status = 'active' and deleted_at is null from neas.profiles where id = '00000000-0000-0000-0000-0000000000e7'));
reset role;
select set_config('request.jwt.claim.sub', '', false);
