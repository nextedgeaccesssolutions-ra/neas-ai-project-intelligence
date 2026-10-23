-- Manual photo locations need approval. A member proposes coordinates for a photo (with a reason);
-- the project manager or a Super Admin approves, rejects or asks for clarification, never their own
-- request (Super Admins excepted). Only an approval writes coordinates to the photo, labelled manual;
-- the previous location is kept on the request. Recorded GPS can no longer be changed any other way.
-- Older gallery photos without saved GPS get their own status: 'no_photo_gps'.

alter table neas.report_attachments drop constraint if exists report_attachments_gps_check;
alter table neas.report_attachments add constraint report_attachments_gps_check check (
  gps_status in ('captured', 'manual', 'unavailable', 'no_photo_gps', 'denied', 'not_requested')
  and (gps_lat is null or gps_lat between -90 and 90)
  and (gps_lng is null or gps_lng between -180 and 180)
  and (gps_accuracy_m is null or gps_accuracy_m >= 0)
  and (gps_heading is null or (gps_heading >= 0 and gps_heading < 360))
  and ((gps_status in ('captured', 'manual')) = (gps_lat is not null and gps_lng is not null))
);

create table if not exists neas.location_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references neas.projects (id) on delete cascade,
  attachment_id uuid not null references neas.report_attachments (id) on delete cascade,
  lat numeric(9, 6) not null check (lat between -90 and 90),
  lng numeric(9, 6) not null check (lng between -180 and 180),
  site_ref text not null default '' check (length(site_ref) <= 200),
  reason text not null check (length(reason) between 3 and 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'clarification')),
  requested_by uuid references neas.profiles (id) default auth.uid(),
  requested_at timestamptz not null default now(),
  decided_by uuid references neas.profiles (id),
  decided_at timestamptz,
  decision_note text not null default '' check (length(decision_note) <= 500),
  prev_status text, prev_source text, prev_lat numeric(9, 6), prev_lng numeric(9, 6), prev_accuracy_m numeric,
  version integer not null default 1,
  updated_at timestamptz not null default now()
);
create unique index if not exists location_requests_one_pending on neas.location_requests (attachment_id) where status = 'pending';
create index if not exists location_requests_project on neas.location_requests (project_id, status);

create or replace function neas.guard_location_request() returns trigger
language plpgsql security definer set search_path = neas, extensions as $$
begin
  if (select project_id from neas.report_attachments where id = new.attachment_id and deleted_at is null) is distinct from new.project_id then
    raise exception 'Photo does not belong to this project' using errcode = '22023';
  end if;
  new.status := 'pending'; new.decided_by := null; new.decided_at := null; new.decision_note := '';
  new.requested_by := coalesce(auth.uid(), new.requested_by);
  return new;
end $$;
drop trigger if exists guard_location_request on neas.location_requests;
create trigger guard_location_request before insert on neas.location_requests for each row execute function neas.guard_location_request();
drop trigger if exists audit_location_requests on neas.location_requests;
create trigger audit_location_requests after insert or update or delete on neas.location_requests for each row execute function neas.audit_row();

alter table neas.location_requests enable row level security;
revoke all on neas.location_requests from anon;
grant select, insert on neas.location_requests to authenticated;
grant all on neas.location_requests to service_role;
drop policy if exists location_requests_select on neas.location_requests;
create policy location_requests_select on neas.location_requests for select to authenticated
  using (neas.is_super_admin() or neas.is_member(project_id));
drop policy if exists location_requests_insert on neas.location_requests;
create policy location_requests_insert on neas.location_requests for insert to authenticated
  with check (neas.is_super_admin() or neas.is_member(project_id));

-- Recorded locations are evidence: outside an approval they cannot be changed, and a photo cannot be
-- created with a manual location. Edits that carry stale location values keep the stored ones.
create or replace function neas.guard_attachment_location() returns trigger
language plpgsql security definer set search_path = neas, extensions as $$
begin
  if auth.uid() is null or coalesce(current_setting('neas.location_approval', true), '') = 'on' then return new; end if;
  if tg_op = 'INSERT' then
    if new.gps_status = 'manual' or new.gps_source = 'manual' then
      raise exception 'Manual locations need approval: save the photo, then use Request manual location' using errcode = '42501';
    end if;
    return new;
  end if;
  if (new.gps_lat, new.gps_lng, new.gps_accuracy_m, new.gps_status, new.gps_source, new.gps_captured_at, new.gps_altitude_m, new.gps_heading)
     is distinct from (old.gps_lat, old.gps_lng, old.gps_accuracy_m, old.gps_status, old.gps_source, old.gps_captured_at, old.gps_altitude_m, old.gps_heading) then
    new.gps_lat := old.gps_lat; new.gps_lng := old.gps_lng; new.gps_accuracy_m := old.gps_accuracy_m; new.gps_status := old.gps_status;
    new.gps_source := old.gps_source; new.gps_captured_at := old.gps_captured_at; new.gps_altitude_m := old.gps_altitude_m; new.gps_heading := old.gps_heading;
  end if;
  return new;
end $$;
drop trigger if exists guard_attachment_location on neas.report_attachments;
create trigger guard_attachment_location before insert or update on neas.report_attachments for each row execute function neas.guard_attachment_location();

create or replace function neas.decide_location_request(p_id uuid, p_decision text, p_note text default '')
returns jsonb language plpgsql security definer set search_path = neas, extensions as $$
declare
  r neas.location_requests%rowtype;
  f neas.report_attachments%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  if p_decision not in ('approved', 'rejected', 'clarification') then raise exception 'Unknown decision' using errcode = '22023'; end if;
  select * into r from neas.location_requests where id = p_id for update;
  if not found then raise exception 'Request not found' using errcode = 'P0002'; end if;
  if r.status not in ('pending', 'clarification') then raise exception 'This request has already been decided' using errcode = '42501'; end if;
  if not (neas.is_super_admin() or neas.is_manager(r.project_id)) then
    raise exception 'Only the project manager or a Super Admin can decide location requests' using errcode = '42501';
  end if;
  if r.requested_by = auth.uid() and not neas.is_super_admin() then
    raise exception 'You cannot approve your own location request' using errcode = '42501';
  end if;
  if p_decision <> 'approved' and length(coalesce(p_note, '')) < 3 then
    raise exception 'Give a reason for rejecting or asking for clarification' using errcode = '22023';
  end if;
  if p_decision = 'approved' then
    select * into f from neas.report_attachments where id = r.attachment_id and deleted_at is null for update;
    if not found then raise exception 'The photo no longer exists' using errcode = 'P0002'; end if;
    perform set_config('neas.location_approval', 'on', true);
    update neas.report_attachments set gps_lat = r.lat, gps_lng = r.lng, gps_accuracy_m = null, gps_altitude_m = null, gps_heading = null,
      gps_status = 'manual', gps_source = 'manual', gps_captured_at = now(),
      location_detail = case when r.site_ref <> '' and location_detail = '' then r.site_ref else location_detail end
    where id = f.id;
    perform set_config('neas.location_approval', 'off', true);
    update neas.location_requests set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = coalesce(p_note, ''),
      prev_status = f.gps_status, prev_source = f.gps_source, prev_lat = f.gps_lat, prev_lng = f.gps_lng, prev_accuracy_m = f.gps_accuracy_m,
      version = version + 1, updated_at = now()
    where id = r.id;
  else
    update neas.location_requests set status = p_decision, decided_by = auth.uid(), decided_at = now(), decision_note = p_note,
      version = version + 1, updated_at = now()
    where id = r.id;
  end if;
  return (select to_jsonb(x) from neas.location_requests x where id = r.id);
end $$;
revoke execute on function neas.decide_location_request(uuid, text, text) from public, anon;
grant execute on function neas.decide_location_request(uuid, text, text) to authenticated;
