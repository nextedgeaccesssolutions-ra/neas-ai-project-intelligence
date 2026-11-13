-- Schedule engine (phase 1): project working calendars, original baseline, actual start/finish,
-- remaining working days, measurable quantities and verified completed quantity on reports.
-- The original baseline is captured on insert and only a Super Admin can change it (formal rebaseline).

create table if not exists neas.project_calendars (
  project_id uuid primary key references neas.projects (id) on delete cascade,
  -- ISO weekdays that are normal working days (1 = Monday … 7 = Sunday)
  work_days smallint[] not null default '{1,2,3,4,5,6,7}',
  -- [{"date":"2026-12-25","kind":"holiday|shutdown|non_working|working","name":"Christmas"}]
  exceptions jsonb not null default '[]'::jsonb,
  hours_per_day numeric(4, 2) not null default 8,
  time_zone text not null default 'Asia/Manila',
  version integer not null default 1,
  updated_by uuid references neas.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (work_days <@ '{1,2,3,4,5,6,7}'::smallint[] and cardinality(work_days) between 1 and 7),
  check (jsonb_typeof(exceptions) = 'array' and jsonb_array_length(exceptions) <= 1000),
  check (hours_per_day > 0 and hours_per_day <= 24),
  check (length(time_zone) between 1 and 64)
);

alter table neas.project_calendars enable row level security;
revoke all on neas.project_calendars from anon;
grant select, insert, update on neas.project_calendars to authenticated;
grant all on neas.project_calendars to service_role;
drop policy if exists project_calendars_select on neas.project_calendars;
create policy project_calendars_select on neas.project_calendars for select to authenticated
  using (neas.is_super_admin() or neas.is_member(project_id));
drop policy if exists project_calendars_write on neas.project_calendars;
create policy project_calendars_write on neas.project_calendars for all to authenticated
  using (neas.is_super_admin() or neas.is_manager(project_id))
  with check (neas.is_super_admin() or neas.is_manager(project_id));

drop trigger if exists touch_project_calendars on neas.project_calendars;
create trigger touch_project_calendars before update on neas.project_calendars for each row execute function neas.touch_row();
drop trigger if exists audit_project_calendars on neas.project_calendars;
create trigger audit_project_calendars after insert or update or delete on neas.project_calendars for each row execute function neas.audit_row();

alter table neas.activities
  add column if not exists baseline_start date,
  add column if not exists baseline_end date,
  add column if not exists actual_start date,
  add column if not exists actual_finish date,
  add column if not exists remaining_days numeric(8, 2),
  add column if not exists quantity_total numeric(14, 3),
  add column if not exists quantity_unit text not null default '',
  add column if not exists delay_reason text not null default '';

update neas.activities set baseline_start = start_date, baseline_end = end_date
where baseline_start is null or baseline_end is null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'activities_schedule_check') then
    alter table neas.activities add constraint activities_schedule_check check (
      (baseline_start is null or baseline_end is null or baseline_end >= baseline_start)
      and (actual_finish is null or (actual_start is not null and actual_finish >= actual_start))
      and (remaining_days is null or remaining_days >= 0)
      and (quantity_total is null or quantity_total > 0)
      and length(quantity_unit) <= 20 and length(delay_reason) <= 500
    );
  end if;
end $$;

-- Baseline: captured from the first planned dates; only a Super Admin may change it afterwards.
create or replace function neas.guard_activity_baseline() returns trigger
language plpgsql security definer set search_path = neas, extensions as $$
begin
  if tg_op = 'INSERT' then
    new.baseline_start := coalesce(new.baseline_start, new.start_date);
    new.baseline_end := coalesce(new.baseline_end, new.end_date);
    return new;
  end if;
  new.baseline_start := coalesce(new.baseline_start, old.baseline_start, new.start_date);
  new.baseline_end := coalesce(new.baseline_end, old.baseline_end, new.end_date);
  if (new.baseline_start is distinct from old.baseline_start or new.baseline_end is distinct from old.baseline_end)
     and old.baseline_start is not null and auth.uid() is not null and not neas.is_super_admin() then
    raise exception 'Only a Super Admin can change the original baseline (use Rebaseline)' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists guard_activities_baseline on neas.activities;
create trigger guard_activities_baseline before insert or update on neas.activities for each row execute function neas.guard_activity_baseline();

-- Verified cumulative quantity reported for a measurable activity (same unit as activities.quantity_unit).
alter table neas.project_reports add column if not exists completed_qty numeric(14, 3);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'project_reports_completed_qty_check') then
    alter table neas.project_reports add constraint project_reports_completed_qty_check check (completed_qty is null or completed_qty >= 0);
  end if;
end $$;
