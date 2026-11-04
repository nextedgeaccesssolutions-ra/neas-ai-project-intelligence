-- Reschedule segment on activities.
reset role;
insert into neas.activities (id, project_id, name, start_date, end_date, weight) values ('30000000-0000-0000-0000-000000000098', '10000000-0000-0000-0000-000000000098', 'Resched test', '2026-09-18', '2026-09-21', 5);
select test.expect_error('reschedule: New finish cannot be before New start', $$update neas.activities set reschedule_start = '2026-10-10', reschedule_end = '2026-10-05' where id = '30000000-0000-0000-0000-000000000098'$$);
select test.expect_error('reschedule: both dates or neither', $$update neas.activities set reschedule_start = '2026-10-10' where id = '30000000-0000-0000-0000-000000000098'$$);
update neas.activities set reschedule_start = '2026-10-05', reschedule_end = '2026-10-10' where id = '30000000-0000-0000-0000-000000000098';
select test.check('reschedule: a reschedule keeps the planned dates and baseline', (select start_date = '2026-09-18' and end_date = '2026-09-21' and baseline_start = '2026-09-18' and reschedule_end = '2026-10-10' from neas.activities where id = '30000000-0000-0000-0000-000000000098'));
