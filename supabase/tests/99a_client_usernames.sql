-- Client usernames + 6-digit passcodes on the shared sign-in page.
reset role;
insert into neas.projects (id, code, name, status, client_portal_enabled) values ('10000000-0000-0000-0000-000000000099', 'PRJ-2026-099', 'Client usernames', 'active', false);

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
select test.expect_error('client login: only a Super Admin adds client logins', $$select neas.admin_create_client_login('10000000-0000-0000-0000-000000000099', 'Client', 'client.one', '482913')$$);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select test.expect_error('client login: passcode must be 6 digits', $$select neas.admin_create_client_login('10000000-0000-0000-0000-000000000099', 'Client', 'client.one', '12ab')$$);
select test.expect_error('client login: a staff username cannot be reused', $$select neas.admin_create_client_login('10000000-0000-0000-0000-000000000099', 'Client', 'pm.alpha', '482913')$$);
select neas.admin_create_client_login('10000000-0000-0000-0000-000000000099', 'Client rep', ' Client.One ', '482913');
select test.expect_error('client login: client usernames are unique', $$select neas.admin_create_client_login('10000000-0000-0000-0000-000000000099', 'Client', 'client.one', '482914')$$);
select test.expect_error('client login: a staff account cannot take a client username', $$select neas.admin_set_username('00000000-0000-0000-0000-0000000000d1', 'client.one')$$);
reset role;
select test.check('client login: passcode stored only as a hash', (select passcode_hash <> '482913' and username = 'client.one' from neas.client_access_credentials where username = 'client.one'));
select test.check('client login: creating it switches the client portal on', (select client_portal_enabled from neas.projects where id = '10000000-0000-0000-0000-000000000099'));
select test.check('client login: sign-in helper is server-only', not has_function_privilege('authenticated', 'neas.client_login_username(text,text,text,text)', 'execute') and not has_function_privilege('anon', 'neas.client_login_username(text,text,text,text)', 'execute'));

set role service_role;
select test.check('client login: right username + passcode opens a session for the project', (select ok and project_code = 'PRJ-2026-099' and session_token is not null from neas.client_login_username('CLIENT.ONE', '482913', 'ip-c1')));
select test.check('client login: wrong passcode is refused', (select not ok from neas.client_login_username('client.one', '000111', 'ip-c1')));
select neas.client_login_username('client.one', '000111', 'ip-c2') from generate_series(1, 5);
select test.check('client login: 5 wrong in 15 minutes blocks even the right passcode', (select not ok and error like 'Too many%' from neas.client_login_username('client.one', '482913', 'ip-c2')));
reset role;
update neas.client_access_credentials set revoked_at = now() where username = 'client.one';
set role service_role;
select test.check('client login: a revoked login cannot sign in', (select not ok from neas.client_login_username('client.one', '482913', 'ip-c3')));
reset role;
