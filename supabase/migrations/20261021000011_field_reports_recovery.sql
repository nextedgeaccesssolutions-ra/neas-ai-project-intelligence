-- Field-report point-in-time recovery: dry run, Super Admin-approved apply, rollback and validation.
-- The past state is rebuilt from the sync_operations ledger (full row image after every synced
-- write) and from soft-deleted rows. These functions never hard-delete anything: restore = undelete
-- or re-insert under the original id; rollback = soft-delete again. Post-target edits are kept.

create table if not exists neas.recovery_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid references neas.profiles (id),
  target_at timestamptz not null,
  project_id uuid,
  status text not null default 'planned' check (status in ('planned', 'applied', 'rolled_back')),
  plan jsonb not null,
  applied_at timestamptz,
  applied_by uuid references neas.profiles (id),
  applied_result jsonb,
  rolled_back_at timestamptz,
  rolled_back_by uuid references neas.profiles (id),
  validation jsonb
);
create index if not exists recovery_runs_created_idx on neas.recovery_runs (created_at desc);

create table if not exists neas.recovery_backups (
  id bigint generated always as identity primary key,
  run_id uuid not null references neas.recovery_runs (id),
  entity text not null check (entity in ('activities', 'project_reports', 'report_attachments')),
  record_id uuid not null,
  action text not null check (action in ('undelete', 'insert')),
  before jsonb,
  restored jsonb not null,
  at timestamptz not null default now()
);
create index if not exists recovery_backups_run_idx on neas.recovery_backups (run_id, id);

alter table neas.recovery_runs enable row level security;
alter table neas.recovery_backups enable row level security;
revoke all on neas.recovery_runs, neas.recovery_backups from anon, authenticated;
grant select on neas.recovery_runs, neas.recovery_backups to authenticated;
grant all on neas.recovery_runs, neas.recovery_backups to service_role;
drop policy if exists recovery_runs_admin on neas.recovery_runs;
create policy recovery_runs_admin on neas.recovery_runs for select to authenticated using (neas.is_super_admin());
drop policy if exists recovery_backups_admin on neas.recovery_backups;
create policy recovery_backups_admin on neas.recovery_backups for select to authenticated using (neas.is_super_admin());

-- State of field-report data as it was at p_at (rows alive at that moment).
create or replace function neas.recovery_snapshot(p_at timestamptz, p_project uuid)
returns table (entity text, record_id uuid, project_id uuid, image jsonb, source text)
language sql stable security definer set search_path = neas, extensions as $$
  with ledger as (
    select distinct on (o.entity, o.record_id) o.entity, o.record_id, o.project_id, o.result -> 'record' as image
    from neas.sync_operations o
    where o.status = 'applied' and o.received_at <= p_at
      and o.entity in ('activities', 'project_reports', 'report_attachments')
      and (p_project is null or o.project_id = p_project)
      and jsonb_typeof(o.result -> 'record') = 'object'
    order by o.entity, o.record_id, o.received_at desc
  ), cur as (
    select 'activities'::text as entity, a.id, a.project_id, to_jsonb(a) as image from neas.activities a
      where a.created_at <= p_at and (p_project is null or a.project_id = p_project)
    union all
    select 'project_reports', r.id, r.project_id, to_jsonb(r) from neas.project_reports r
      where r.created_at <= p_at and (p_project is null or r.project_id = p_project)
    union all
    select 'report_attachments', f.id, f.project_id, to_jsonb(f) from neas.report_attachments f
      where f.created_at <= p_at and (p_project is null or f.project_id = p_project)
  ), cur_wins as (
    -- The live row is the truth at p_at when it has not changed since, or was deleted before p_at
    -- (web/admin writes, including deletes, never reach the sync ledger).
    select c.entity, c.id from cur c
    where (c.image ->> 'updated_at')::timestamptz <= p_at or (c.image ->> 'deleted_at')::timestamptz <= p_at
  ), merged as (
    select l.entity, l.record_id, l.project_id, l.image, 'sync_ledger'::text as source from ledger l
    where not exists (select 1 from cur_wins w where w.entity = l.entity and w.id = l.record_id)
    union all
    select c.entity, c.id, c.project_id,
      case when (c.image ->> 'deleted_at')::timestamptz > p_at then c.image || '{"deleted_at": null}'::jsonb else c.image end,
      'current_row'
    from cur c
    where not exists (select 1 from ledger l where l.entity = c.entity and l.record_id = c.id)
       or exists (select 1 from cur_wins w where w.entity = c.entity and w.id = c.id)
  )
  select m.entity, m.record_id, m.project_id, m.image, m.source from merged m
  where m.image ->> 'deleted_at' is null or (m.image ->> 'deleted_at')::timestamptz > p_at;
$$;
revoke execute on function neas.recovery_snapshot(timestamptz, uuid) from public, anon, authenticated;

create or replace function neas.recovery_label(p_entity text, p_image jsonb) returns text
language sql immutable as $$
  select case p_entity
    when 'activities' then coalesce(p_image ->> 'name', '')
    when 'project_reports' then coalesce(p_image ->> 'report_date', '') || ' · ' || left(coalesce(p_image ->> 'notes', ''), 80)
    else coalesce(nullif(p_image ->> 'caption', ''), p_image ->> 'storage_path', '')
  end
$$;

-- Dry run: what a restore to p_at would do. Changes nothing except recording the plan.
create or replace function neas.recovery_plan_field_reports(p_at timestamptz default '2026-10-21 17:00:00+08', p_project uuid default null)
returns jsonb language plpgsql security definer set search_path = neas, extensions as $$
declare
  ignored constant text[] := array['updated_at', 'version', 'updated_by', 'created_at'];
  s record;
  cur jsonb;
  img jsonb;
  reason text;
  note text;
  diff text[];
  v_restore jsonb := '[]'::jsonb;
  v_conflicts jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_missing jsonb := '[]'::jsonb;
  v_unchanged integer := 0;
  v_changed integer := 0;
  restore_ids uuid[] := '{}';
  v_snap jsonb;
  v_after jsonb;
  v_ledger jsonb;
  v_plan jsonb;
  v_run uuid;
begin
  if not neas.is_super_admin() then
    raise exception 'Only a Super Admin can plan a data recovery' using errcode = '42501';
  end if;
  if p_at is null or p_at > now() then
    raise exception 'Choose a recovery point in the past';
  end if;

  for s in
    select * from neas.recovery_snapshot(p_at, p_project)
    order by case entity when 'activities' then 1 when 'project_reports' then 2 else 3 end, record_id
  loop
    execute format('select to_jsonb(t) from neas.%I t where t.id = $1', s.entity) into cur using s.record_id;
    img := s.image;

    if cur is not null and cur ->> 'deleted_at' is null then
      if (cur ->> 'updated_at')::timestamptz <= p_at then
        v_unchanged := v_unchanged + 1;
      else
        v_changed := v_changed + 1;
        select array_agg(k order by k) into diff
        from jsonb_object_keys(cur) k
        where k <> all (ignored) and (cur -> k) is distinct from (img -> k);
        if diff is not null then
          v_conflicts := v_conflicts || jsonb_build_object(
            'entity', s.entity, 'record_id', s.record_id, 'project_id', s.project_id,
            'label', neas.recovery_label(s.entity, cur), 'fields', to_jsonb(diff),
            'resolution', 'Changed after the recovery point; the current version is kept');
        end if;
      end if;
      continue;
    end if;

    reason := null;
    note := null;
    if not exists (select 1 from neas.projects p where p.id = s.project_id) then
      reason := 'The project no longer exists';
    elsif s.entity = 'project_reports' then
      if img ->> 'activity_id' is not null
         and not exists (select 1 from neas.activities a where a.id = (img ->> 'activity_id')::uuid and a.deleted_at is null)
         and not ((img ->> 'activity_id')::uuid = any (restore_ids)) then
        img := jsonb_set(img, '{activity_id}', 'null'::jsonb);
        note := 'Activity is no longer available; restored without the activity link';
      end if;
      if exists (
        select 1 from neas.project_reports r
        where r.id <> s.record_id and r.deleted_at is null and r.project_id = s.project_id
          and r.report_date = (img ->> 'report_date')::date
          and r.activity_id is not distinct from (img ->> 'activity_id')::uuid
          and r.actual_pct is not distinct from (img ->> 'actual_pct')::numeric
          and r.notes is not distinct from (img ->> 'notes')
      ) then
        reason := 'An identical report already exists (possible duplicate)';
      end if;
    elsif s.entity = 'report_attachments' then
      if img ->> 'report_id' is not null
         and not exists (select 1 from neas.project_reports r where r.id = (img ->> 'report_id')::uuid and r.deleted_at is null)
         and not ((img ->> 'report_id')::uuid = any (restore_ids)) then
        reason := 'Its field report is not available';
      elsif not exists (select 1 from storage.objects o where o.bucket_id = 'neas-project-files' and o.name = img ->> 'storage_path') then
        reason := 'File is missing from storage';
        v_missing := v_missing || jsonb_build_object('record_id', s.record_id, 'project_id', s.project_id,
          'storage_path', img ->> 'storage_path', 'label', neas.recovery_label(s.entity, img));
      elsif exists (select 1 from neas.report_attachments f where f.id <> s.record_id and f.deleted_at is null and f.storage_path = img ->> 'storage_path') then
        reason := 'Another attachment already uses this file (possible duplicate)';
      end if;
    end if;

    if reason is not null then
      v_skipped := v_skipped || jsonb_build_object('entity', s.entity, 'record_id', s.record_id, 'project_id', s.project_id,
        'label', neas.recovery_label(s.entity, img), 'reason', reason);
      continue;
    end if;

    v_restore := v_restore || jsonb_build_object(
      'entity', s.entity, 'record_id', s.record_id, 'project_id', s.project_id,
      'action', case when cur is null then 'insert' else 'undelete' end,
      'deleted_at', cur ->> 'deleted_at', 'source', s.source,
      'label', neas.recovery_label(s.entity, img), 'note', note, 'image', img);
    restore_ids := restore_ids || s.record_id;
  end loop;

  select coalesce(jsonb_object_agg(e, n), '{}'::jsonb) into v_snap
  from (select entity e, count(*) n from neas.recovery_snapshot(p_at, p_project) group by entity) x;

  select jsonb_build_object(
    'activities', (select count(*) from neas.activities a where a.created_at > p_at and a.deleted_at is null and (p_project is null or a.project_id = p_project)),
    'project_reports', (select count(*) from neas.project_reports r where r.created_at > p_at and r.deleted_at is null and (p_project is null or r.project_id = p_project)),
    'report_attachments', (select count(*) from neas.report_attachments f where f.created_at > p_at and f.deleted_at is null and (p_project is null or f.project_id = p_project))
  ) into v_after;

  select jsonb_build_object(
    'operations_total', count(*),
    'operations_before_target', count(*) filter (where o.received_at <= p_at),
    'first_received_at', min(o.received_at),
    'last_received_before_target', max(o.received_at) filter (where o.received_at <= p_at)
  ) into v_ledger
  from neas.sync_operations o
  where o.status = 'applied' and o.entity in ('activities', 'project_reports', 'report_attachments')
    and (p_project is null or o.project_id = p_project);

  v_plan := jsonb_build_object(
    'target_at', p_at,
    'project_id', p_project,
    'source', 'Sync ledger row images (neas.sync_operations) up to the recovery point, plus soft-deleted rows',
    'ledger', v_ledger,
    'snapshot_counts', v_snap,
    'restore', v_restore,
    'update', '[]'::jsonb,
    'conflicts', v_conflicts,
    'skipped', v_skipped,
    'missing_files', v_missing,
    'unchanged', v_unchanged,
    'changed_after', v_changed,
    'created_after', v_after);

  insert into neas.recovery_runs (created_by, target_at, project_id, plan)
  values (auth.uid(), p_at, p_project, v_plan) returning id into v_run;

  perform neas.write_audit('recovery:dry_run', p_project, 'recovery_runs', v_run::text, jsonb_build_object(
    'target_at', p_at, 'to_restore', jsonb_array_length(v_restore), 'conflicts', jsonb_array_length(v_conflicts),
    'skipped', jsonb_array_length(v_skipped), 'missing_files', jsonb_array_length(v_missing), 'unchanged', v_unchanged));

  return v_plan || jsonb_build_object('run_id', v_run);
end $$;

-- Post-restore checks: snapshot counts versus what is live now, plus link integrity.
create or replace function neas.recovery_validate_field_reports(p_run uuid)
returns jsonb language plpgsql security definer set search_path = neas, extensions as $$
declare
  run neas.recovery_runs;
  v_expected jsonb;
  v_present jsonb;
  v_missing jsonb;
  v_integrity jsonb;
  v_restored jsonb;
  res jsonb;
begin
  if not neas.is_super_admin() then
    raise exception 'Only a Super Admin can validate a data recovery' using errcode = '42501';
  end if;
  select * into run from neas.recovery_runs where id = p_run;
  if not found then raise exception 'Recovery run not found'; end if;

  v_expected := run.plan -> 'snapshot_counts';

  with snap as (select * from neas.recovery_snapshot(run.target_at, run.project_id)),
  live as (
    select s.entity, s.record_id, s.image, case s.entity
      when 'activities' then exists (select 1 from neas.activities a where a.id = s.record_id and a.deleted_at is null)
      when 'project_reports' then exists (select 1 from neas.project_reports r where r.id = s.record_id and r.deleted_at is null)
      else exists (select 1 from neas.report_attachments f where f.id = s.record_id and f.deleted_at is null)
    end as alive
    from snap s
  )
  select
    coalesce((select jsonb_object_agg(entity, n) from (select entity, count(*) n from live where alive group by entity) x), '{}'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('entity', entity, 'record_id', record_id, 'label', neas.recovery_label(entity, image))) from (select * from live where not alive limit 100) y), '[]'::jsonb)
  into v_present, v_missing;

  select jsonb_build_object(
    'reports_without_project', (select count(*) from neas.project_reports r where r.deleted_at is null and (run.project_id is null or r.project_id = run.project_id)
      and not exists (select 1 from neas.projects p where p.id = r.project_id)),
    'reports_with_deleted_activity', (select count(*) from neas.project_reports r where r.deleted_at is null and r.activity_id is not null and (run.project_id is null or r.project_id = run.project_id)
      and not exists (select 1 from neas.activities a where a.id = r.activity_id and a.deleted_at is null)),
    'attachments_with_deleted_report', (select count(*) from neas.report_attachments f where f.deleted_at is null and f.report_id is not null and (run.project_id is null or f.project_id = run.project_id)
      and not exists (select 1 from neas.project_reports r where r.id = f.report_id and r.deleted_at is null)),
    'attachments_missing_file', (select count(*) from neas.report_attachments f where f.deleted_at is null and (run.project_id is null or f.project_id = run.project_id)
      and not exists (select 1 from storage.objects o where o.bucket_id = 'neas-project-files' and o.name = f.storage_path))
  ) into v_integrity;

  select jsonb_build_object(
    'total', count(*),
    'live', count(*) filter (where case b.entity
      when 'activities' then exists (select 1 from neas.activities a where a.id = b.record_id and a.deleted_at is null)
      when 'project_reports' then exists (select 1 from neas.project_reports r where r.id = b.record_id and r.deleted_at is null)
      else exists (select 1 from neas.report_attachments f where f.id = b.record_id and f.deleted_at is null) end))
  into v_restored from neas.recovery_backups b where b.run_id = p_run;

  res := jsonb_build_object(
    'checked_at', now(),
    'expected', v_expected,
    'present', v_present,
    'not_present', v_missing,
    'integrity', v_integrity,
    'restored', v_restored,
    'integrity_ok', (select bool_and(value::text = '0') from jsonb_each(v_integrity)));

  update neas.recovery_runs set validation = res where id = p_run;
  return res;
end $$;

-- Apply a dry run. Atomic: everything is restored or nothing is. Requires typing RESTORE.
create or replace function neas.recovery_apply_field_reports(p_run uuid, p_confirm text)
returns jsonb language plpgsql security definer set search_path = neas, extensions as $$
declare
  run neas.recovery_runs;
  item jsonb;
  img jsonb;
  cur jsonb;
  ent text;
  v_id uuid;
  cols text;
  k text;
  v_restored jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_valid jsonb;
  res jsonb;
begin
  if not neas.is_super_admin() then
    raise exception 'Only a Super Admin can apply a data recovery' using errcode = '42501';
  end if;
  if p_confirm is distinct from 'RESTORE' then
    raise exception 'Type RESTORE to confirm the recovery';
  end if;
  select * into run from neas.recovery_runs where id = p_run for update;
  if not found then raise exception 'Recovery run not found'; end if;
  if run.status <> 'planned' then raise exception 'This recovery run was already %', replace(run.status, '_', ' '); end if;
  if run.created_at < now() - interval '1 hour' then
    raise exception 'This dry run is more than an hour old. Run a new dry run first.';
  end if;

  for item in select value from jsonb_array_elements(run.plan -> 'restore') loop
    ent := item ->> 'entity';
    v_id := (item ->> 'record_id')::uuid;
    img := item -> 'image';
    if ent not in ('activities', 'project_reports', 'report_attachments') then
      raise exception 'Unsupported record type in recovery plan';
    end if;
    execute format('select to_jsonb(t) from neas.%I t where t.id = $1 for update', ent) into cur using v_id;

    if item ->> 'action' = 'undelete' then
      if cur is null or cur ->> 'deleted_at' is null then
        v_skipped := v_skipped || jsonb_build_object('entity', ent, 'record_id', v_id, 'reason', 'Changed since the dry run');
        continue;
      end if;
      insert into neas.recovery_backups (run_id, entity, record_id, action, before, restored) values (p_run, ent, v_id, 'undelete', cur, img);
      execute format('update neas.%I set deleted_at = null where id = $1', ent) using v_id;
    else
      if cur is not null then
        v_skipped := v_skipped || jsonb_build_object('entity', ent, 'record_id', v_id, 'reason', 'Changed since the dry run');
        continue;
      end if;
      foreach k in array array['submitted_by', 'reviewed_by', 'uploaded_by', 'updated_by'] loop
        if img ? k and img ->> k is not null and not exists (select 1 from neas.profiles p where p.id = (img ->> k)::uuid) then
          img := jsonb_set(img, array[k], 'null'::jsonb);
        end if;
      end loop;
      img := img || '{"deleted_at": null}'::jsonb;
      select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position) into cols
      from information_schema.columns c
      where c.table_schema = 'neas' and c.table_name = ent and img ? c.column_name;
      execute format('insert into neas.%1$I (%2$s) select %2$s from jsonb_populate_record(null::neas.%1$I, $1)', ent, cols) using img;
      insert into neas.recovery_backups (run_id, entity, record_id, action, before, restored) values (p_run, ent, v_id, 'insert', null, img);
      -- the insert trigger stamps the restoring admin as submitter; put the original back.
      -- The touch also moves updated_at forward so devices pull the restored row.
      if ent = 'project_reports' then
        update neas.project_reports set submitted_by = (img ->> 'submitted_by')::uuid where id = v_id;
      else
        execute format('update neas.%I set deleted_at = null where id = $1', ent) using v_id;
      end if;
    end if;
    v_restored := v_restored || jsonb_build_object('entity', ent, 'record_id', v_id, 'action', item ->> 'action');
  end loop;

  res := jsonb_build_object('restored', v_restored, 'skipped', v_skipped);
  update neas.recovery_runs set status = 'applied', applied_at = now(), applied_by = auth.uid(), applied_result = res where id = p_run;
  v_valid := neas.recovery_validate_field_reports(p_run);

  perform neas.write_audit('recovery:applied', run.project_id, 'recovery_runs', p_run::text, jsonb_build_object(
    'target_at', run.target_at, 'source', run.plan ->> 'source',
    'restored', jsonb_array_length(v_restored), 'skipped', jsonb_array_length(v_skipped),
    'skipped_in_plan', jsonb_array_length(run.plan -> 'skipped'), 'conflicts', jsonb_array_length(run.plan -> 'conflicts'),
    'record_ids', (select coalesce(jsonb_agg(r -> 'record_id'), '[]'::jsonb) from jsonb_array_elements(v_restored) r),
    'integrity_ok', v_valid -> 'integrity_ok'));

  return res || jsonb_build_object('validation', v_valid);
end $$;

-- Undo an applied run: re-deletes (softly) exactly what the run restored.
create or replace function neas.recovery_rollback_field_reports(p_run uuid, p_confirm text)
returns jsonb language plpgsql security definer set search_path = neas, extensions as $$
declare
  run neas.recovery_runs;
  b neas.recovery_backups;
  n integer := 0;
begin
  if not neas.is_super_admin() then
    raise exception 'Only a Super Admin can roll back a data recovery' using errcode = '42501';
  end if;
  if p_confirm is distinct from 'ROLLBACK' then
    raise exception 'Type ROLLBACK to confirm';
  end if;
  select * into run from neas.recovery_runs where id = p_run for update;
  if not found then raise exception 'Recovery run not found'; end if;
  if run.status <> 'applied' then raise exception 'Only an applied recovery can be rolled back'; end if;

  for b in select * from neas.recovery_backups where run_id = p_run order by id desc loop
    if b.action = 'undelete' then
      execute format('update neas.%I set deleted_at = $2 where id = $1 and deleted_at is null', b.entity) using b.record_id, (b.before ->> 'deleted_at')::timestamptz;
    else
      execute format('update neas.%I set deleted_at = now() where id = $1 and deleted_at is null', b.entity) using b.record_id;
    end if;
    n := n + 1;
  end loop;

  update neas.recovery_runs set status = 'rolled_back', rolled_back_at = now(), rolled_back_by = auth.uid() where id = p_run;
  perform neas.write_audit('recovery:rolled_back', run.project_id, 'recovery_runs', p_run::text, jsonb_build_object('records', n));
  return jsonb_build_object('rolled_back', n);
end $$;

revoke execute on function neas.recovery_plan_field_reports(timestamptz, uuid) from public, anon;
revoke execute on function neas.recovery_apply_field_reports(uuid, text) from public, anon;
revoke execute on function neas.recovery_rollback_field_reports(uuid, text) from public, anon;
revoke execute on function neas.recovery_validate_field_reports(uuid) from public, anon;
grant execute on function neas.recovery_plan_field_reports(timestamptz, uuid) to authenticated;
grant execute on function neas.recovery_apply_field_reports(uuid, text) to authenticated;
grant execute on function neas.recovery_rollback_field_reports(uuid, text) to authenticated;
grant execute on function neas.recovery_validate_field_reports(uuid) to authenticated;
