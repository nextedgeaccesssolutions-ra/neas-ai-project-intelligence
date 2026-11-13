-- Work stoppages: STOP WORK / RESTART WORK events per activity. Records are never deleted or
-- rewritten: a stop is recorded once, and its restart is added to the same row exactly once.
-- Any project member may record a stop; only a project manager or Super Admin may confirm a
-- restart, and only with the safety clearance confirmed (the software never lifts a safety hold).

create table if not exists neas.activity_stops (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references neas.projects (id) on delete cascade,
  activity_id uuid not null references neas.activities (id) on delete cascade,
  stopped_at timestamptz not null,
  reason text not null,
  remarks text not null default '',
  supervisor text not null default '',
  affects_schedule boolean not null default true,
  restarted_at timestamptz,
  restart_supervisor text not null default '',
  restart_remarks text not null default '',
  safety_cleared boolean not null default false,
  remaining_days numeric(8, 2),
  created_by uuid references neas.profiles (id) default auth.uid(),
  restarted_by uuid references neas.profiles (id),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (reason in ('weather', 'wind', 'client_instruction', 'site_access', 'safety', 'equipment', 'manpower', 'material', 'other')),
  check (length(remarks) <= 1000 and length(restart_remarks) <= 1000 and length(supervisor) <= 120 and length(restart_supervisor) <= 120),
  check (restarted_at is null or (restarted_at >= stopped_at and safety_cleared and length(restart_supervisor) > 0)),
  check (remaining_days is null or remaining_days >= 0),
  check (reason <> 'other' or length(remarks) > 0)
);
create index if not exists activity_stops_activity on neas.activity_stops (activity_id, stopped_at);
-- one open stoppage per activity
create unique index if not exists activity_stops_one_open on neas.activity_stops (activity_id) where restarted_at is null;

create or replace function neas.guard_activity_stop() returns trigger
language plpgsql security definer set search_path = neas, extensions as $$
begin
  if tg_op = 'INSERT' then
    if (select project_id from neas.activities where id = new.activity_id) is distinct from new.project_id then
      raise exception 'Activity does not belong to this project' using errcode = '22023';
    end if;
    if new.restarted_at is not null then
      raise exception 'Record the stop first, then the restart' using errcode = '22023';
    end if;
    -- restart fields are filled only by the restart itself; authors come from the session
    new.safety_cleared := false; new.restart_supervisor := ''; new.restart_remarks := '';
    new.remaining_days := null; new.restarted_by := null;
    new.created_by := coalesce(auth.uid(), new.created_by);
    return new;
  end if;
  -- UPDATE: only the restart may be added, once; the stop record itself is frozen
  if old.restarted_at is not null then
    raise exception 'This stoppage is closed; record a new stop instead' using errcode = '42501';
  end if;
  if (new.id, new.project_id, new.activity_id, new.stopped_at, new.reason, new.remarks, new.supervisor, new.affects_schedule, new.created_by, new.created_at)
     is distinct from (old.id, old.project_id, old.activity_id, old.stopped_at, old.reason, old.remarks, old.supervisor, old.affects_schedule, old.created_by, old.created_at) then
    raise exception 'A recorded stop cannot be changed' using errcode = '42501';
  end if;
  -- the only allowed change is the single transition to restarted
  if new.restarted_at is null then
    raise exception 'Only a restart can be added to a recorded stop' using errcode = '42501';
  end if;
  if new.restarted_at is not null and auth.uid() is not null
     and not (neas.is_super_admin() or neas.is_manager(new.project_id)) then
    raise exception 'Only the project manager or a Super Admin can confirm a restart' using errcode = '42501';
  end if;
  new.restarted_by := coalesce(auth.uid(), new.restarted_by);
  return new;
end $$;

drop trigger if exists guard_activity_stop on neas.activity_stops;
create trigger guard_activity_stop before insert or update on neas.activity_stops for each row execute function neas.guard_activity_stop();
drop trigger if exists touch_activity_stops on neas.activity_stops;
create trigger touch_activity_stops before update on neas.activity_stops for each row execute function neas.touch_row();
drop trigger if exists audit_activity_stops on neas.activity_stops;
create trigger audit_activity_stops after insert or update or delete on neas.activity_stops for each row execute function neas.audit_row();

alter table neas.activity_stops enable row level security;
revoke all on neas.activity_stops from anon;
grant select, insert, update on neas.activity_stops to authenticated;
grant all on neas.activity_stops to service_role;
drop policy if exists activity_stops_select on neas.activity_stops;
create policy activity_stops_select on neas.activity_stops for select to authenticated
  using (neas.is_super_admin() or neas.is_member(project_id));
drop policy if exists activity_stops_insert on neas.activity_stops;
create policy activity_stops_insert on neas.activity_stops for insert to authenticated
  with check (neas.is_super_admin() or neas.is_member(project_id));
drop policy if exists activity_stops_update on neas.activity_stops;
create policy activity_stops_update on neas.activity_stops for update to authenticated
  using (neas.is_super_admin() or neas.is_manager(project_id))
  with check (neas.is_super_admin() or neas.is_manager(project_id));
