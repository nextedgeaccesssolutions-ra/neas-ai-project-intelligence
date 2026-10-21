-- User administration: session revocation, password setup tracking, role limits.
reset role;
select set_config('request.jwt.claims', '', false);
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  ('00000000-0000-0000-0000-0000000000f2', 'field.f@neas.test', '{"full_name":"Field Foxtrot"}', now());
insert into auth.sessions (user_id) values ('00000000-0000-0000-0000-0000000000f2'), ('00000000-0000-0000-0000-0000000000f2');

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select neas.admin_review_registration('00000000-0000-0000-0000-0000000000f2', true, null);

-- f2 signed in a minute ago (token issued before the revocation below)
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f2', false);
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000f2', 'iat', floor(extract(epoch from clock_timestamp()))::bigint - 60)::text, false);
select test.check('sessions: approved user is active with a current token', neas.is_active_user());
select test.expect_error('sessions: staff cannot revoke other people''s sessions',
  $$select neas.admin_revoke_sessions('00000000-0000-0000-0000-0000000000a1')$$);
select neas.mark_password_set();
select test.check('password: setup is recorded for the account', (select password_set_at is not null from neas.profiles where id = auth.uid()));

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select set_config('request.jwt.claims', '', false);
select neas.admin_revoke_sessions('00000000-0000-0000-0000-0000000000f2', 'Lost phone');

reset role;
select test.check('sessions: refresh sessions are deleted on revoke', (select count(*) = 0 from auth.sessions where user_id = '00000000-0000-0000-0000-0000000000f2'));
select test.check('sessions: revocation and password setup are in the audit log',
  (select count(*) = 1 from neas.audit_logs where action = 'account:sessions_revoked' and target_id = '00000000-0000-0000-0000-0000000000f2')
  and (select count(*) = 1 from neas.audit_logs where action = 'account:password_set' and target_id = '00000000-0000-0000-0000-0000000000f2'));
set role authenticated;

-- the old access token stops working at once; a new sign-in works
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f2', false);
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000f2', 'iat', floor(extract(epoch from clock_timestamp()))::bigint - 60)::text, false);
select test.check('sessions: token issued before revocation is refused', not neas.is_active_user());
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000f2', 'iat', floor(extract(epoch from clock_timestamp()))::bigint + 5)::text, false);
select test.check('sessions: signing in again restores access', neas.is_active_user());

-- an old Super Admin token cannot administer either
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select set_config('request.jwt.claims', '', false);
select neas.admin_set_global_role('00000000-0000-0000-0000-0000000000f2', 'super_admin');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f2', false);
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000f2', 'iat', floor(extract(epoch from clock_timestamp()))::bigint + 5)::text, false);
select test.check('roles: promoted user is Super Admin with a current token', neas.is_super_admin());
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000f2', 'iat', 1)::text, false);
select test.check('roles: Super Admin rights also end with a revoked token', not neas.is_super_admin());

-- suspension ends sessions too
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select set_config('request.jwt.claims', '', false);
select neas.admin_set_global_role('00000000-0000-0000-0000-0000000000f2', 'staff');
reset role;
insert into auth.sessions (user_id) values ('00000000-0000-0000-0000-0000000000f2');
update neas.profiles set sessions_revoked_at = null where id = '00000000-0000-0000-0000-0000000000f2';
set role authenticated;
select neas.admin_set_user_status('00000000-0000-0000-0000-0000000000f2', 'suspended', 'Contract ended');
reset role;
select test.check('suspension: also signs the user out everywhere',
  (select sessions_revoked_at is not null from neas.profiles where id = '00000000-0000-0000-0000-0000000000f2')
  and (select count(*) = 0 from auth.sessions where user_id = '00000000-0000-0000-0000-0000000000f2'));
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f2', false);
select test.expect_error('profiles: users cannot clear their own revocation',
  $$update neas.profiles set sessions_revoked_at = null where id = '00000000-0000-0000-0000-0000000000f2'$$);
reset role;
select set_config('request.jwt.claims', '', false);
