-- One-time codes for employees and clients.
reset role;
select set_config('request.jwt.claims', '', false);

-- ---------- employees ----------
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000e5', 'crew.e5@neas.test', '{"full_name":"Crew Echo"}', now());

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select test.expect_error('setup code: refused for an account that is not approved yet',
  $$select * from neas.admin_issue_setup_code('00000000-0000-0000-0000-0000000000e5')$$);
select neas.admin_review_registration('00000000-0000-0000-0000-0000000000e5', true, null);
select test.setv('code_old', (select code from neas.admin_issue_setup_code('00000000-0000-0000-0000-0000000000e5', 72)));
select test.setv('code_e5', (select code from neas.admin_issue_setup_code('00000000-0000-0000-0000-0000000000e5', 72)));
select test.check('setup code: 12-character code in XXXX-XXXX-XXXX form', test.v('code_e5') ~ '^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$', test.v('code_e5'));

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e5', false);
select test.expect_error('setup code: staff cannot issue codes',
  $$select * from neas.admin_issue_setup_code('00000000-0000-0000-0000-0000000000e5')$$);
select test.expect_error('setup code: browsers cannot redeem codes directly',
  $$select * from neas.redeem_setup_code('crew.e5@neas.test', 'AAAA-BBBB-CCCC', 'ip')$$);

reset role;
select test.check('setup code: only a hash is stored', (select bool_and(code_hash like '$2%' and code_hash not like '%' || replace(test.v('code_e5'), '-', '') || '%') from neas.user_setup_codes where user_id = '00000000-0000-0000-0000-0000000000e5'));
set role service_role;
select test.check('setup code: an earlier code stops working when a new one is issued', (select not ok from neas.redeem_setup_code('crew.e5@neas.test', test.v('code_old'), 'ip-e5')));
select test.check('setup code: wrong code gives a generic message', (select not ok and error like 'E-mail or code is not valid%' from neas.redeem_setup_code('crew.e5@neas.test', 'WRON-GWRO-NGXX', 'ip-e5')));
select test.check('setup code: correct code works once (case and dashes ignored)', (select ok and user_id = '00000000-0000-0000-0000-0000000000e5' from neas.redeem_setup_code('CREW.E5@neas.test', lower(replace(test.v('code_e5'), '-', ' ')), 'ip-e5')));
select test.check('setup code: cannot be used a second time', (select not ok from neas.redeem_setup_code('crew.e5@neas.test', test.v('code_e5'), 'ip-e5b')));
reset role;
select test.check('setup code: password setup and use are recorded',
  (select password_set_at is not null from neas.profiles where id = '00000000-0000-0000-0000-0000000000e5')
  and (select count(*) = 1 from neas.audit_logs where action = 'account:setup_code_used' and target_id = '00000000-0000-0000-0000-0000000000e5'));
-- expired codes
update neas.user_setup_codes set used_at = null, expires_at = now() - interval '1 minute' where user_id = '00000000-0000-0000-0000-0000000000e5' and used_at is not null;
set role service_role;
select test.check('setup code: expired code is refused', (select not ok from neas.redeem_setup_code('crew.e5@neas.test', test.v('code_e5'), 'ip-x9')));
-- throttling: 5 failures from one address lock it for 15 minutes, even for a valid code
select neas.redeem_setup_code('nobody@neas.test', 'AAAA-AAAA-AAAA', 'ip-brute') from generate_series(1, 5);
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select test.setv('code_e5c', (select code from neas.admin_issue_setup_code('00000000-0000-0000-0000-0000000000e5', 1)));
reset role;
set role service_role;
select test.check('setup code: throttled after 5 failed tries from the same address', (select not ok and error like 'Too many attempts%' from neas.redeem_setup_code('crew.e5@neas.test', test.v('code_e5c'), 'ip-brute')));
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select test.setv('code_e5d', (select code from neas.admin_issue_setup_code('00000000-0000-0000-0000-0000000000e5', 24)));
select neas.admin_set_user_status('00000000-0000-0000-0000-0000000000e5', 'suspended', 'test');
reset role;
set role service_role;
select test.check('setup code: a suspended account cannot redeem a valid code', (select not ok and error like 'E-mail or code is not valid%' from neas.redeem_setup_code('crew.e5@neas.test', test.v('code_e5d'), 'ip-fresh')));
reset role;

-- ---------- clients ----------
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
insert into neas.projects (id, code, name, status, client_portal_enabled) values ('10000000-0000-0000-0000-000000000088', 'PRJ-2026-088', 'Client codes', 'active', true);
select test.setv('c_once', neas.admin_create_client_passcode('10000000-0000-0000-0000-000000000088', 'Owner rep', null, false, true));
select test.setv('c_multi', neas.admin_create_client_passcode('10000000-0000-0000-0000-000000000088', 'Site team', null, false, false));
update neas.approved_client_content set session_hours = 720 where project_id = '10000000-0000-0000-0000-000000000088';
select test.check('client: sessions can last up to 30 days', (select session_hours = 720 from neas.approved_client_content where project_id = '10000000-0000-0000-0000-000000000088'));
select test.expect_error('client: sessions longer than 30 days are refused',
  $$update neas.approved_client_content set session_hours = 721 where project_id = '10000000-0000-0000-0000-000000000088'$$);
reset role;
set role service_role;
select test.check('client: one-time passcode works the first time (30-day session)', (select ok and expires_at > now() + interval '29 days' from neas.client_login('PRJ-2026-088', test.v('c_once'), 'ip-c1')));
select test.check('client: one-time passcode is refused the second time', (select not ok from neas.client_login('PRJ-2026-088', test.v('c_once'), 'ip-c2')));
select test.check('client: reusable passcode works more than once',
  (select ok from neas.client_login('PRJ-2026-088', test.v('c_multi'), 'ip-c3')) and (select ok from neas.client_login('PRJ-2026-088', test.v('c_multi'), 'ip-c3')));
reset role;
select test.check('client: use count is tracked', (select max_uses = 1 and use_count = 1 from neas.client_access_credentials where project_id = '10000000-0000-0000-0000-000000000088' and label = 'Owner rep'));

-- service role (server routes) can read and update profiles and write audit entries
set role service_role;
select test.check('server: service role can read profiles', (select count(*) > 0 from neas.profiles));
update neas.profiles set last_login_at = now() where id = '00000000-0000-0000-0000-0000000000a1';
insert into neas.audit_logs (actor_id, action, target_type, target_id) values ('00000000-0000-0000-0000-0000000000a1', 'auth:login', 'profiles', '00000000-0000-0000-0000-0000000000a1');
select test.check('server: service role can update profiles and write the audit log', (select count(*) >= 1 from neas.audit_logs where action = 'auth:login'));
reset role;

-- Control panel reads passcode metadata (including use limits) but never the hash
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select test.check('client creds: Super Admin can list passcodes with use limits',
  (select count(*) >= 2 from (select id, project_id, label, created_at, expires_at, revoked_at, last_used_at, max_uses, use_count from neas.client_access_credentials) x));
select test.expect_error('client creds: the passcode hash stays unreadable',
  $$select passcode_hash from neas.client_access_credentials$$);
reset role;
