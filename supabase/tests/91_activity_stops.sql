-- Work stoppages: stop by any member, restart only by PM/Super Admin with safety clearance, history kept.
reset role;
select set_config('request.jwt.claim.sub', '', false);
-- d1 (an employee of another project) joins this one as field staff
insert into neas.project_memberships (project_id, user_id, role) values
  ('10000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d1', 'employee');

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);
insert into neas.activity_stops (id, project_id, activity_id, stopped_at, reason, supervisor)
values ('30000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-0000000000d1', '20000000-0000-0000-0000-0000000000d1', '2026-11-06 10:00+08', 'weather', 'R. Santos');
select test.check('stops: a field employee can record STOP WORK',
  exists (select 1 from neas.activity_stops where id = '30000000-0000-0000-0000-0000000000d1' and created_by = '00000000-0000-0000-0000-0000000000d1'));
select test.expect_error('stops: only one open stoppage per activity',
  $$insert into neas.activity_stops (project_id, activity_id, stopped_at, reason) values ('10000000-0000-0000-0000-0000000000d1', '20000000-0000-0000-0000-0000000000d1', '2026-11-06 11:00+08', 'wind')$$);
select test.expect_error('stops: "other" needs remarks',
  $$insert into neas.activity_stops (project_id, activity_id, stopped_at, reason) values ('10000000-0000-0000-0000-0000000000d1', '20000000-0000-0000-0000-0000000000d1', '2026-11-06 11:00+08', 'other')$$);
update neas.activity_stops set restarted_at = '2026-11-07 08:00+08', safety_cleared = true, restart_supervisor = 'R. Santos'
where id = '30000000-0000-0000-0000-0000000000d1';
select test.check('stops: an employee cannot confirm a restart',
  (select restarted_at is null from neas.activity_stops where id = '30000000-0000-0000-0000-0000000000d1'));

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
select test.expect_error('stops: a restart without safety clearance is refused',
  $$update neas.activity_stops set restarted_at = '2026-11-07 08:00+08', restart_supervisor = 'R. Santos' where id = '30000000-0000-0000-0000-0000000000d1'$$);
select test.expect_error('stops: the recorded stop cannot be rewritten',
  $$update neas.activity_stops set reason = 'client_instruction' where id = '30000000-0000-0000-0000-0000000000d1'$$);
update neas.activity_stops set restarted_at = '2026-11-07 08:00+08', safety_cleared = true, restart_supervisor = 'R. Santos', remaining_days = 4
where id = '30000000-0000-0000-0000-0000000000d1';
select test.check('stops: the project manager confirms the restart',
  (select restarted_at is not null and restarted_by = '00000000-0000-0000-0000-0000000000b1' from neas.activity_stops where id = '30000000-0000-0000-0000-0000000000d1'));
select test.expect_error('stops: a closed stoppage cannot be reopened or edited',
  $$update neas.activity_stops set restarted_at = '2026-11-08 08:00+08' where id = '30000000-0000-0000-0000-0000000000d1'$$);
insert into neas.activity_stops (project_id, activity_id, stopped_at, reason, remarks) values
  ('10000000-0000-0000-0000-0000000000d1', '20000000-0000-0000-0000-0000000000d1', '2026-11-09 13:00+08', 'other', 'Gondola inspection');
select test.check('stops: multiple stop/restart cycles are kept',
  (select count(*) = 2 from neas.activity_stops where activity_id = '20000000-0000-0000-0000-0000000000d1'));
select test.expect_error('stops: restart fields cannot be edited without a restart',
  $$update neas.activity_stops set safety_cleared = true, restart_supervisor = 'X', remaining_days = 1 where restarted_at is null$$);
select test.check('stops: restart fields cannot be pre-filled at stop time',
  not exists (select 1 from neas.activity_stops where restarted_at is null and (safety_cleared or remaining_days is not null)));
select test.expect_error('stops: records cannot be deleted',
  $$delete from neas.activity_stops where id = '30000000-0000-0000-0000-0000000000d1'$$);

reset role;
delete from neas.project_memberships where project_id = '10000000-0000-0000-0000-0000000000d1' and user_id = '00000000-0000-0000-0000-0000000000d1';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);
select test.check('stops: members of other projects cannot see them',
  not exists (select 1 from neas.activity_stops where project_id = '10000000-0000-0000-0000-0000000000d1'));
reset role;
select set_config('request.jwt.claim.sub', '', false);
