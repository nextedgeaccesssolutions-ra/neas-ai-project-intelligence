-- New passcode for a client username login; restores a revoked one.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select neas.admin_create_client_login('10000000-0000-0000-0000-000000000098', 'Reset me', 'reset.client', '582913');
reset role;
update neas.client_access_credentials set revoked_at = now() where username = 'reset.client';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
select test.expect_error('reset: only a Super Admin resets a client login', $$select neas.admin_reset_client_login((select id from neas.client_access_credentials where username = 'reset.client'), '714285')$$);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select test.expect_error('reset: the passcode must be 6 digits', $$select neas.admin_reset_client_login((select id from neas.client_access_credentials where username = 'reset.client'), '12')$$);
select neas.admin_reset_client_login((select id from neas.client_access_credentials where username = 'reset.client'), '714285');
reset role;
select test.check('reset: a revoked client login is restored', (select revoked_at is null from neas.client_access_credentials where username = 'reset.client'));
set role service_role;
select test.check('reset: the new passcode signs in', (select ok from neas.client_login_username('reset.client', '714285', 'ip-r1')));
select test.check('reset: the old passcode no longer signs in', (select not ok from neas.client_login_username('reset.client', '582913', 'ip-r2')));
reset role;
