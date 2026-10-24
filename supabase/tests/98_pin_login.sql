-- Username + PIN sign-in: usernames, lockout, PIN re-check for sensitive changes.
reset role;
select set_config('request.jwt.claim.sub', '', false);

-- usernames are set by a Super Admin only
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
select test.expect_error('pin: only a Super Admin sets usernames', $$select neas.admin_set_username('00000000-0000-0000-0000-0000000000d1', 'tech.bravo')$$);
select test.expect_error('pin: people cannot change their own username directly', $$update neas.profiles set username = 'me' where id = auth.uid()$$);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select test.check('pin: a Super Admin sets a username (stored lower-case)', neas.admin_set_username('00000000-0000-0000-0000-0000000000d1', '  Tech.Bravo ') = 'tech.bravo');
select test.expect_error('pin: usernames are unique', $$select neas.admin_set_username('00000000-0000-0000-0000-0000000000b1', 'tech.bravo')$$);
select test.expect_error('pin: badly formed usernames are refused', $$select neas.admin_set_username('00000000-0000-0000-0000-0000000000b1', 'x y')$$);
select neas.admin_set_username('00000000-0000-0000-0000-0000000000b1', 'pm.alpha');
reset role;

-- sign-in helpers are server-only
select test.check('pin: sign-in helpers are closed to signed-in users and anon',
  not has_function_privilege('authenticated', 'neas.pin_login_begin(text,text)', 'execute')
  and not has_function_privilege('anon', 'neas.pin_login_finish(text,text,boolean)', 'execute')
  and not has_function_privilege('authenticated', 'neas.mark_reauth(uuid)', 'execute'));

set role service_role;
select test.check('pin: a known active username may be tried and returns its sign-in address',
  (select allowed and email = 'tech.b@neas.test' from neas.pin_login_begin('Tech.Bravo', 'ip-pin-1')));
select test.check('pin: an unknown username looks the same (allowed, no address, same message)',
  (select allowed and email is null and error = (select error from neas.pin_login_begin('tech.bravo', 'ip-pin-1')) from neas.pin_login_begin('nobody.here', 'ip-pin-1')));
select neas.pin_login_finish('tech.bravo', 'ip-pin-2', false) from generate_series(1, 4);
select test.check('pin: the fifth wrong PIN in 15 minutes locks the username', neas.pin_login_finish('tech.bravo', 'ip-pin-2', false) = 'locked_15');
select test.check('pin: a locked username cannot be tried', (select not allowed and email is null from neas.pin_login_begin('tech.bravo', 'ip-pin-3')));
-- ten failures in a day lock the account until a Super Admin unlocks it
update neas.pin_login_attempts set at = now() - interval '2 hours' where username = 'tech.bravo';
select neas.pin_login_finish('tech.bravo', 'ip-pin-2', false) from generate_series(1, 4);
select test.check('pin: the tenth wrong PIN in 24 hours locks the account', neas.pin_login_finish('tech.bravo', 'ip-pin-2', false) = 'locked_admin');
reset role;
select test.check('pin: the lock is recorded on the account and in the audit log',
  (select pin_locked_at is not null from neas.profiles where username = 'tech.bravo')
  and exists (select 1 from neas.audit_logs where action = 'auth:pin_locked'));
update neas.pin_login_attempts set at = now() - interval '1 hour' where username = 'tech.bravo';
set role service_role;
select test.check('pin: an account lock outlasts the 15-minute window', (select not allowed from neas.pin_login_begin('tech.bravo', 'ip-pin-4')));
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select neas.admin_unlock_pin('00000000-0000-0000-0000-0000000000d1');
reset role;
set role service_role;
select test.check('pin: after a Super Admin unlocks it the person can try again', (select allowed from neas.pin_login_begin('tech.bravo', 'ip-pin-5')));
select test.check('pin: a successful sign-in is recorded', neas.pin_login_finish('tech.bravo', 'ip-pin-5', true) = 'ok');
-- unknown usernames lock exactly like real ones, so the messages never reveal which exist
select neas.pin_login_finish('ghost.user', 'ip-pin-6', false) from generate_series(1, 9);
select test.check('pin: an unknown username reaches the same 24-hour lock as a real one', neas.pin_login_finish('ghost.user', 'ip-pin-6', false) = 'locked_admin');
select test.check('pin: an unknown locked username gets the same message as a real locked one',
  (select error from neas.pin_login_begin('ghost.user', 'ip-pin-7')) like 'This account is locked for 24 hours%');
reset role;
-- the 24-hour lock ends by itself
update neas.profiles set pin_locked_at = now() - interval '25 hours' where username = 'tech.bravo';
delete from neas.pin_login_attempts where username = 'tech.bravo';
set role service_role;
select test.check('pin: a 24-hour lock ends by itself', (select allowed from neas.pin_login_begin('tech.bravo', 'ip-pin-8')));
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);
select test.expect_error('pin: people cannot mark their own PIN re-check', $$update neas.profiles set reauth_at = now() + interval '1 year' where id = auth.uid()$$);
select test.expect_error('pin: people cannot call the re-check marker', $$select neas.mark_reauth(auth.uid())$$);
reset role;

-- PIN re-check for sensitive changes
update neas.profiles set reauth_at = null where id = '00000000-0000-0000-0000-0000000000a1';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select test.expect_error('pin: changing someone''s role needs a recent PIN re-check',
  $$select neas.admin_set_global_role('00000000-0000-0000-0000-0000000000d1', 'super_admin')$$);
select test.expect_error('pin: creating a client passcode needs a recent PIN re-check',
  $$select neas.admin_create_client_passcode('10000000-0000-0000-0000-00000000000a')$$);
select test.expect_error('pin: creating a share link needs a recent PIN re-check',
  $$select neas.create_report_share('10000000-0000-0000-0000-00000000000a', 'link', 7)$$);
select test.expect_error('pin: adding someone to a project needs a recent PIN re-check',
  $$insert into neas.project_memberships (project_id, user_id, role) values ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000b1', 'project_manager')$$);
select test.expect_error('pin: changing what clients see needs a recent PIN re-check',
  $$insert into neas.approved_client_content (project_id, show_photos) values ('10000000-0000-0000-0000-00000000000b', true) on conflict (project_id) do update set show_photos = true$$);
select test.expect_error('pin: unlocking a PIN needs a recent PIN re-check', $$select neas.admin_unlock_pin('00000000-0000-0000-0000-0000000000d1')$$);
update neas.profiles set full_name = 'Super Admin' where id = auth.uid();
select test.check('pin: ordinary edits do not need a re-check', (select full_name = 'Super Admin' from neas.profiles where id = auth.uid()));
reset role;
set role service_role;
select neas.mark_reauth('00000000-0000-0000-0000-0000000000a1');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select test.check('pin: after the re-check the change goes through',
  (select (neas.create_report_share('10000000-0000-0000-0000-00000000000a', 'link', 1) ->> 'token') is not null));
reset role;
update neas.profiles set reauth_at = now() - interval '11 minutes' where id = '00000000-0000-0000-0000-0000000000a1';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select test.check('pin: a re-check expires after 10 minutes', not neas.recent_reauth());
reset role;
update neas.profiles set reauth_at = now() + interval '7 days' where id = '00000000-0000-0000-0000-0000000000a1';
select set_config('request.jwt.claim.sub', '', false);
