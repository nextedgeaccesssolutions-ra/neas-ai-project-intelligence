-- Field-report point-in-time recovery: dry run, approval, restore, rollback, audit.
reset role;
select set_config('request.jwt.claim.sub', '', false);
select set_config('request.jwt.claims', '', false);

-- Project C keeps this scenario apart from the earlier fixtures.
insert into neas.projects (id, code, name, status) values ('10000000-0000-0000-0000-0000000000cc', 'PRJ-2026-090', 'Recovery Charlie', 'active');
select test.setv('t_create', (now() - interval '3 hours')::text);
select test.setv('t_target', (now() - interval '2 hours')::text);

insert into neas.activities (id, project_id, name, start_date, end_date, weight, created_at, updated_at) values
  ('20000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-0000000000cc', 'Mobilization', '2026-10-01', '2026-10-31', 50,
   test.v('t_create')::timestamptz, test.v('t_create')::timestamptz);
insert into neas.project_reports (id, project_id, activity_id, report_date, actual_pct, notes, submitted_by, created_at, updated_at) values
  ('30000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-0000000000cc', '20000000-0000-0000-0000-0000000000c1', '2026-10-21', 10, 'Scaffold up', '00000000-0000-0000-0000-0000000000c1',
   test.v('t_create')::timestamptz, test.v('t_create')::timestamptz),
  ('30000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-0000000000cc', '20000000-0000-0000-0000-0000000000c1', '2026-10-21', 20, 'Cleaning started', '00000000-0000-0000-0000-0000000000c1',
   test.v('t_create')::timestamptz, test.v('t_create')::timestamptz),
  ('30000000-0000-0000-0000-0000000000c4', '10000000-0000-0000-0000-0000000000cc', null, '2026-10-20', 5, 'Deleted on purpose before the recovery point', '00000000-0000-0000-0000-0000000000c1',
   test.v('t_create')::timestamptz, test.v('t_create')::timestamptz);
insert into storage.objects (bucket_id, name) values ('neas-project-files', '10000000-0000-0000-0000-0000000000cc/before.jpg');
insert into neas.report_attachments (id, project_id, report_id, kind, storage_path, mime_type, bytes, created_at, updated_at) values
  ('40000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-0000000000cc', '30000000-0000-0000-0000-0000000000c1', 'before', '10000000-0000-0000-0000-0000000000cc/before.jpg', 'image/jpeg', 1000,
   test.v('t_create')::timestamptz, test.v('t_create')::timestamptz),
  ('40000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-0000000000cc', '30000000-0000-0000-0000-0000000000c1', 'after', '10000000-0000-0000-0000-0000000000cc/gone.jpg', 'image/jpeg', 1000,
   test.v('t_create')::timestamptz, test.v('t_create')::timestamptz);

-- Ledger: every write above was synced before the recovery point.
insert into neas.sync_operations (op_id, user_id, project_id, entity, record_id, op, status, result, received_at)
select gen_random_uuid(), '00000000-0000-0000-0000-0000000000a1', x.project_id, x.entity, x.id, 'upsert', 'applied',
       jsonb_build_object('status', 'applied', 'record', x.rec), test.v('t_create')::timestamptz
from (
  select 'activities' entity, a.id, a.project_id, to_jsonb(a) rec from neas.activities a where a.project_id = '10000000-0000-0000-0000-0000000000cc'
  union all select 'project_reports', r.id, r.project_id, to_jsonb(r) from neas.project_reports r where r.project_id = '10000000-0000-0000-0000-0000000000cc'
  union all select 'report_attachments', f.id, f.project_id, to_jsonb(f) from neas.report_attachments f where f.project_id = '10000000-0000-0000-0000-0000000000cc'
) x;

-- Before the recovery point, from the web (never in the ledger): a deliberate delete.
update neas.project_reports set deleted_at = test.v('t_create')::timestamptz + interval '30 minutes' where id = '30000000-0000-0000-0000-0000000000c4';

-- After the recovery point: data loss (soft and hard deletes), a legitimate edit and a new report.
update neas.report_attachments set deleted_at = now() where project_id = '10000000-0000-0000-0000-0000000000cc';
update neas.project_reports set deleted_at = now() where id = '30000000-0000-0000-0000-0000000000c1';
delete from neas.project_reports where id = '30000000-0000-0000-0000-0000000000c2';
update neas.activities set name = 'Mobilization (renamed)' where id = '20000000-0000-0000-0000-0000000000c1';
insert into neas.project_reports (id, project_id, report_date, actual_pct, notes) values
  ('30000000-0000-0000-0000-0000000000c3', '10000000-0000-0000-0000-0000000000cc', '2026-10-22', 30, 'Made after the recovery point');

-- Only a Super Admin can run any part of it.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
select test.expect_error('recovery: an employee cannot run a dry run',
  $$select neas.recovery_plan_field_reports(now() - interval '2 hours', '10000000-0000-0000-0000-0000000000cc')$$);
select test.check('recovery: an employee cannot read recovery runs', (select count(*) = 0 from neas.recovery_runs));

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select test.expect_error('recovery: a future recovery point is refused',
  $$select neas.recovery_plan_field_reports(now() + interval '1 day', null)$$);

select test.setv('plan', neas.recovery_plan_field_reports(test.v('t_target')::timestamptz, '10000000-0000-0000-0000-0000000000cc')::text);
select test.setv('run', test.v('plan')::jsonb ->> 'run_id');

select test.check('recovery: dry run lists the soft-deleted and hard-deleted reports and the photo',
  (select count(*) = 3 from jsonb_array_elements(test.v('plan')::jsonb -> 'restore') e
   where e ->> 'record_id' in ('30000000-0000-0000-0000-0000000000c1', '30000000-0000-0000-0000-0000000000c2', '40000000-0000-0000-0000-0000000000c1'))
  and jsonb_array_length(test.v('plan')::jsonb -> 'restore') = 3, test.v('plan'));
select test.check('recovery: hard-deleted report is re-inserted, soft-deleted one is undeleted',
  (select string_agg(e ->> 'action', ',' order by e ->> 'record_id') = 'undelete,insert,undelete'
   from jsonb_array_elements(test.v('plan')::jsonb -> 'restore') e));
select test.check('recovery: a report deleted before the recovery point is not revived',
  not (test.v('plan')::jsonb -> 'restore') @> '[{"record_id": "30000000-0000-0000-0000-0000000000c4"}]');
select test.check('recovery: a photo whose file is gone is reported, not restored',
  jsonb_array_length(test.v('plan')::jsonb -> 'missing_files') = 1
  and (test.v('plan')::jsonb -> 'skipped') @> '[{"record_id": "40000000-0000-0000-0000-0000000000c2"}]');
select test.check('recovery: edits made after the recovery point are flagged and kept',
  (test.v('plan')::jsonb -> 'conflicts') @> '[{"record_id": "20000000-0000-0000-0000-0000000000c1", "fields": ["name"]}]');
select test.check('recovery: data created after the recovery point is counted as preserved',
  (test.v('plan')::jsonb -> 'created_after' ->> 'project_reports')::int = 1);
select test.check('recovery: snapshot counts match the state at the recovery point',
  test.v('plan')::jsonb -> 'snapshot_counts' = '{"activities": 1, "project_reports": 2, "report_attachments": 2}'::jsonb, test.v('plan')::jsonb ->> 'snapshot_counts');
select test.check('recovery: a dry run changes no data',
  (select deleted_at is not null from neas.project_reports where id = '30000000-0000-0000-0000-0000000000c1')
  and not exists (select 1 from neas.project_reports where id = '30000000-0000-0000-0000-0000000000c2'));

select test.expect_error('recovery: apply without typing RESTORE is refused',
  format('select neas.recovery_apply_field_reports(%L, %L)', test.v('run'), 'yes'));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
select test.expect_error('recovery: a project manager cannot apply a recovery',
  format('select neas.recovery_apply_field_reports(%L, %L)', test.v('run'), 'RESTORE'));

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select test.setv('applied', neas.recovery_apply_field_reports(test.v('run')::uuid, 'RESTORE')::text);
select test.check('recovery: reports and photo are live again under their original ids',
  (select count(*) = 2 from neas.project_reports where id in ('30000000-0000-0000-0000-0000000000c1', '30000000-0000-0000-0000-0000000000c2') and deleted_at is null)
  and (select deleted_at is null from neas.report_attachments where id = '40000000-0000-0000-0000-0000000000c1'), test.v('applied'));
select test.check('recovery: re-inserted report keeps its original submitter and content',
  (select submitted_by = '00000000-0000-0000-0000-0000000000c1' and notes = 'Cleaning started' and actual_pct = 20
   from neas.project_reports where id = '30000000-0000-0000-0000-0000000000c2'));
select test.check('recovery: later data is preserved',
  (select name = 'Mobilization (renamed)' from neas.activities where id = '20000000-0000-0000-0000-0000000000c1')
  and exists (select 1 from neas.project_reports where id = '30000000-0000-0000-0000-0000000000c3' and deleted_at is null));
select test.check('recovery: no duplicate reports were created',
  (select count(*) = 3 from neas.project_reports where project_id = '10000000-0000-0000-0000-0000000000cc' and deleted_at is null));
select test.check('recovery: the missing-file photo stays deleted',
  (select deleted_at is not null from neas.report_attachments where id = '40000000-0000-0000-0000-0000000000c2'));
select test.check('recovery: the prior state was backed up before restoring',
  (select count(*) = 3 from neas.recovery_backups where run_id = test.v('run')::uuid));
select test.check('recovery: validation matches the snapshot and finds no broken links',
  (test.v('applied')::jsonb -> 'validation' -> 'present' ->> 'project_reports')::int = 2
  and (test.v('applied')::jsonb -> 'validation' ->> 'integrity_ok')::boolean, test.v('applied')::jsonb ->> 'validation');
select test.expect_error('recovery: a run cannot be applied twice',
  format('select neas.recovery_apply_field_reports(%L, %L)', test.v('run'), 'RESTORE'));

select test.setv('rb', neas.recovery_rollback_field_reports(test.v('run')::uuid, 'ROLLBACK')::text);
select test.check('recovery: rollback soft-deletes exactly what was restored',
  (select count(*) = 2 from neas.project_reports where id in ('30000000-0000-0000-0000-0000000000c1', '30000000-0000-0000-0000-0000000000c2') and deleted_at is not null)
  and exists (select 1 from neas.project_reports where id = '30000000-0000-0000-0000-0000000000c3' and deleted_at is null), test.v('rb'));
select test.check('recovery: rollback never hard-deletes',
  exists (select 1 from neas.project_reports where id = '30000000-0000-0000-0000-0000000000c2'));

reset role;
select set_config('request.jwt.claim.sub', '', false);
select test.check('recovery: dry run, apply and rollback are in the audit log',
  (select count(distinct action) = 3 from neas.audit_logs
   where target_id = test.v('run') and action in ('recovery:dry_run', 'recovery:applied', 'recovery:rolled_back')));
