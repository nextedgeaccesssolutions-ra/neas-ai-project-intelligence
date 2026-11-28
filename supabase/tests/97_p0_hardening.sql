-- P0 hardening: function permissions and storage object rules.
reset role;
select set_config('request.jwt.claim.sub', '', false);

select test.check('perm: no neas function is executable by PUBLIC',
  not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where p.pronamespace = 'neas'::regnamespace and a.grantee = 0 and a.privilege_type = 'EXECUTE'));
select test.check('perm: anon cannot execute any neas function',
  not exists (select 1 from pg_proc p where p.pronamespace = 'neas'::regnamespace and has_function_privilege('anon', p.oid, 'execute')));
select test.check('perm: signed-in users cannot write audit entries directly',
  not has_function_privilege('authenticated', 'neas.write_audit(text,uuid,text,text,jsonb,text)', 'execute'));
select test.check('perm: server-only functions are closed to signed-in users',
  not has_function_privilege('authenticated', 'neas.client_login(text,text,text,text)', 'execute')
  and not has_function_privilege('authenticated', 'neas.client_snapshot(text)', 'execute')
  and not has_function_privilege('authenticated', 'neas.share_snapshot(text)', 'execute')
  and not has_function_privilege('authenticated', 'neas.redeem_setup_code(text,text,text)', 'execute'));
select test.check('perm: the service role keeps the server-only functions',
  has_function_privilege('service_role', 'neas.client_login(text,text,text,text)', 'execute')
  and has_function_privilege('service_role', 'neas.share_snapshot(text)', 'execute'));
select test.check('perm: signed-in users keep the functions the app calls',
  has_function_privilege('authenticated', 'neas.apply_operation(jsonb)', 'execute')
  and has_function_privilege('authenticated', 'neas.pull_changes(uuid,timestamptz)', 'execute')
  and has_function_privilege('authenticated', 'neas.is_member(uuid)', 'execute')
  and has_function_privilege('authenticated', 'neas.create_report_share(uuid,text,integer,text,text,text)', 'execute')
  and has_function_privilege('authenticated', 'neas.move_items_to_group(uuid,text,uuid[])', 'execute'));
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
select test.expect_error('perm: forging an audit entry is refused', $$select neas.write_audit('fake:action', null, 'x', 'y')$$);
reset role;

-- storage: objects in project A
insert into storage.buckets (id, name) values ('neas-project-files', 'neas-project-files') on conflict do nothing;
insert into neas.project_memberships (project_id, user_id, role) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000d1', 'employee') on conflict do nothing;
insert into storage.objects (bucket_id, name, owner) values
  ('neas-project-files', '10000000-0000-0000-0000-00000000000a/p0-mine.jpg', '00000000-0000-0000-0000-0000000000d1'),
  ('neas-project-files', '10000000-0000-0000-0000-00000000000a/p0-other.jpg', '00000000-0000-0000-0000-0000000000b1'),
  ('neas-project-files', '10000000-0000-0000-0000-00000000000a/p0-approved.jpg', '00000000-0000-0000-0000-0000000000d1');
insert into neas.project_reports (id, project_id, report_date, status, submitted_by) values
  ('90000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', current_date, 'approved', '00000000-0000-0000-0000-0000000000d1');
insert into neas.report_attachments (id, project_id, report_id, kind, storage_path, mime_type, bytes, uploaded_by) values
  ('50000000-0000-0000-0000-0000000000c9', '10000000-0000-0000-0000-00000000000a', '90000000-0000-0000-0000-0000000000a1', 'after',
   '10000000-0000-0000-0000-00000000000a/p0-approved.jpg', 'image/jpeg', 10, '00000000-0000-0000-0000-0000000000d1');

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);
select test.check('storage: an employee reads their own upload', exists (select 1 from storage.objects where name like '%p0-mine.jpg'));
select test.check('storage: an employee cannot read another person''s unapproved file', not exists (select 1 from storage.objects where name like '%p0-other.jpg'));
select test.check('storage: the uploader can still overwrite an unapproved photo', neas.can_overwrite_object('10000000-0000-0000-0000-00000000000a/p0-mine.jpg', '00000000-0000-0000-0000-0000000000d1'));
select test.check('storage: nobody but a Super Admin overwrites a photo once its report is approved', not neas.can_overwrite_object('10000000-0000-0000-0000-00000000000a/p0-approved.jpg', '00000000-0000-0000-0000-0000000000d1'));
select test.check('storage: an employee cannot overwrite someone else''s file', not neas.can_overwrite_object('10000000-0000-0000-0000-00000000000a/p0-other.jpg', '00000000-0000-0000-0000-0000000000b1'));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
select test.check('storage: the project manager reads files that have an attachment row', exists (select 1 from storage.objects where name like '%p0-approved.jpg'));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', false);
select test.check('storage: a non-member reads nothing', not exists (select 1 from storage.objects where name like '%/p0-%'));
reset role;
delete from neas.project_memberships where project_id = '10000000-0000-0000-0000-00000000000a' and user_id = '00000000-0000-0000-0000-0000000000d1';
select set_config('request.jwt.claim.sub', '', false);
