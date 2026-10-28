-- Client sign-in on Draft projects; revoking project passcodes keeps username logins.
reset role;
insert into neas.projects (id, code, name, status, client_portal_enabled) values ('10000000-0000-0000-0000-000000000097', 'PRJ-2026-097', 'Draft client view', 'draft', false);
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select neas.admin_create_client_login('10000000-0000-0000-0000-000000000097', 'Draft client', 'draft.client', '582917');
create temp table dp_code as select neas.admin_create_client_passcode('10000000-0000-0000-0000-000000000097', 'Rep', null, false, false) as c;
select neas.admin_create_client_passcode('10000000-0000-0000-0000-000000000097', 'Rep 2', null, true, false);
reset role;
select test.check('draft: revoking project passcodes keeps the client username login', (select revoked_at is null from neas.client_access_credentials where username = 'draft.client'));
select test.check('draft: revoking project passcodes revokes the older shared passcode', (select count(*) = 1 from neas.client_access_credentials where project_id = '10000000-0000-0000-0000-000000000097' and username is null and revoked_at is not null));
set role service_role;
select test.check('draft: a client can sign in to a Draft project with viewing on', (select ok from neas.client_login_username('draft.client', '582917', 'ip-d1')));
reset role;
update neas.projects set client_portal_enabled = false where id = '10000000-0000-0000-0000-000000000097';
set role service_role;
select test.check('draft: viewing off still blocks sign-in', (select not ok from neas.client_login_username('draft.client', '582917', 'ip-d2')));
reset role;
drop table dp_code;
