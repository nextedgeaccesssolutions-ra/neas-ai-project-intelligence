-- Schedule engine phase 1: baseline capture/protection, actual dates, quantities, calendars.
reset role;
select set_config('request.jwt.claim.sub', '', false);
select set_config('request.jwt.claims', '', false);

insert into neas.projects (id, code, name, status) values ('10000000-0000-0000-0000-0000000000d1', 'PRJ-2026-091', 'Schedule Delta', 'active');
insert into neas.project_memberships (project_id, user_id, role) values
  ('10000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', 'project_manager');
insert into neas.activities (id, project_id, name, start_date, end_date, weight, quantity_total, quantity_unit) values
  ('20000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-0000000000d1', 'Facade cleaning', '2026-11-02', '2026-11-11', 60, 1000, 'm2');

select test.check('schedule: baseline is captured from the first planned dates',
  (select baseline_start = '2026-11-02' and baseline_end = '2026-11-11' from neas.activities where id = '20000000-0000-0000-0000-0000000000d1'));

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
update neas.activities set start_date = '2026-11-05', end_date = '2026-11-14', delay_reason = 'Weather',
  actual_start = '2026-11-05', remaining_days = 7
where id = '20000000-0000-0000-0000-0000000000d1';
select test.check('schedule: a project manager can postpone a scope without touching the baseline',
  (select start_date = '2026-11-05' and baseline_start = '2026-11-02' and baseline_end = '2026-11-11' and delay_reason = 'Weather'
   from neas.activities where id = '20000000-0000-0000-0000-0000000000d1'));
select test.expect_error('schedule: a project manager cannot change the original baseline',
  $$update neas.activities set baseline_start = '2026-11-05' where id = '20000000-0000-0000-0000-0000000000d1'$$);
select test.expect_error('schedule: an actual finish before the actual start is refused',
  $$update neas.activities set actual_finish = '2026-11-01' where id = '20000000-0000-0000-0000-0000000000d1'$$);
select test.expect_error('schedule: negative remaining days are refused',
  $$update neas.activities set remaining_days = -1 where id = '20000000-0000-0000-0000-0000000000d1'$$);

insert into neas.project_calendars (project_id, work_days, exceptions)
values ('10000000-0000-0000-0000-0000000000d1', '{1,2,3,4,5,6}', '[{"date":"2026-11-30","kind":"holiday","name":"Bonifacio Day"}]');
select test.check('calendar: a project manager can set the working calendar',
  (select work_days = '{1,2,3,4,5,6}' from neas.project_calendars where project_id = '10000000-0000-0000-0000-0000000000d1'));
select test.expect_error('calendar: invalid weekdays are refused',
  $$update neas.project_calendars set work_days = '{0,8}' where project_id = '10000000-0000-0000-0000-0000000000d1'$$);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
select test.check('calendar: a non-member cannot read another project''s calendar',
  not exists (select 1 from neas.project_calendars where project_id = '10000000-0000-0000-0000-0000000000d1'));

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
update neas.activities set baseline_start = '2026-11-05', baseline_end = '2026-11-14' where id = '20000000-0000-0000-0000-0000000000d1';
select test.check('schedule: a Super Admin can rebaseline',
  (select baseline_start = '2026-11-05' from neas.activities where id = '20000000-0000-0000-0000-0000000000d1'));

insert into neas.project_reports (project_id, activity_id, report_date, actual_pct, completed_qty)
values ('10000000-0000-0000-0000-0000000000d1', '20000000-0000-0000-0000-0000000000d1', '2026-11-06', 40, 400);
select test.check('schedule: reports store the verified completed quantity',
  exists (select 1 from neas.project_reports where activity_id = '20000000-0000-0000-0000-0000000000d1' and completed_qty = 400));
select test.expect_error('schedule: a negative completed quantity is refused',
  $$insert into neas.project_reports (project_id, activity_id, report_date, actual_pct, completed_qty)
    values ('10000000-0000-0000-0000-0000000000d1', '20000000-0000-0000-0000-0000000000d1', '2026-11-07', 40, -5)$$);
reset role;
select set_config('request.jwt.claim.sub', '', false);
