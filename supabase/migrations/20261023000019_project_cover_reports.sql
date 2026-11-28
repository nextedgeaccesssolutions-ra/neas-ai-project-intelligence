-- Project cover / building reference photos and the project report log.
-- Cover photos are ordinary evidence records (new kind 'reference', or any existing photo marked as
-- cover), so no image is stored twice. Members may upload reference photos; only the project manager
-- or a Super Admin decides which photos are on the cover, their order and the primary photo.
-- Clients only ever see cover photos that are also approved for them (client_visible).

alter table neas.report_attachments drop constraint if exists report_attachments_kind_check;
alter table neas.report_attachments add constraint report_attachments_kind_check
  check (kind in ('before', 'during', 'after', 'inspection', 'safety', 'defect', 'reference', 'document'));

alter table neas.report_attachments
  add column if not exists cover_category text,
  add column if not exists is_cover boolean not null default false,
  add column if not exists cover_order smallint,
  add column if not exists cover_primary boolean not null default false;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'report_attachments_cover_check') then
    alter table neas.report_attachments add constraint report_attachments_cover_check check (
      (cover_category is null or cover_category in ('main_building', 'site_overview', 'exterior', 'entrance', 'roof_work_area', 'other'))
      and (cover_order is null or cover_order between 0 and 999)
      and (not cover_primary or is_cover)
    );
  end if;
end $$;
create unique index if not exists report_attachments_one_primary_cover
  on neas.report_attachments (project_id) where cover_primary and deleted_at is null;

create or replace function neas.guard_cover_photo() returns trigger
language plpgsql security definer set search_path = neas, extensions as $$
begin
  if auth.uid() is null or neas.is_super_admin() or neas.is_manager(new.project_id) then return new; end if;
  if tg_op = 'INSERT' then
    if new.is_cover or new.cover_primary or new.cover_order is not null then
      raise exception 'Only the project manager or a Super Admin can choose cover photos' using errcode = '42501';
    end if;
  elsif (new.is_cover, new.cover_primary, new.cover_order) is distinct from (old.is_cover, old.cover_primary, old.cover_order) then
    raise exception 'Only the project manager or a Super Admin can choose cover photos' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists guard_cover_photo on neas.report_attachments;
create trigger guard_cover_photo before insert or update on neas.report_attachments for each row execute function neas.guard_cover_photo();

-- every generated project report (internal users), for the audit trail and the Google Sheet
create table if not exists neas.project_report_exports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references neas.projects (id) on delete cascade,
  report_ref text not null unique,
  report_kind text not null default 'project_report',
  file_format text not null default 'pdf',
  period_from date,
  period_to date,
  planned_pct numeric(6, 2),
  actual_pct numeric(6, 2),
  schedule_status text not null default '',
  approval_status text not null default 'not_recorded',
  generated_by uuid references neas.profiles (id) default auth.uid(),
  generated_at timestamptz not null default now(),
  check (file_format in ('pdf', 'pptx', 'docx')),
  check (length(report_ref) between 3 and 120 and length(schedule_status) <= 60),
  check (approval_status in ('not_recorded', 'pending', 'approved'))
);
create index if not exists project_report_exports_project on neas.project_report_exports (project_id, generated_at desc);
alter table neas.project_report_exports enable row level security;
revoke all on neas.project_report_exports from anon;
grant select, insert on neas.project_report_exports to authenticated;
grant all on neas.project_report_exports to service_role;
drop policy if exists project_report_exports_select on neas.project_report_exports;
create policy project_report_exports_select on neas.project_report_exports for select to authenticated
  using (neas.is_super_admin() or neas.is_member(project_id));
drop policy if exists project_report_exports_insert on neas.project_report_exports;
create policy project_report_exports_insert on neas.project_report_exports for insert to authenticated
  with check ((neas.is_super_admin() or neas.is_member(project_id)) and generated_by = auth.uid());
drop trigger if exists audit_project_report_exports on neas.project_report_exports;
create trigger audit_project_report_exports after insert or update or delete on neas.project_report_exports for each row execute function neas.audit_row();

create or replace function neas.client_snapshot(p_token text)
returns jsonb language plpgsql security definer set search_path = neas, extensions as $$
declare
  s neas.client_sessions%rowtype;
  p neas.projects%rowtype;
  c neas.approved_client_content%rowtype;
  result jsonb;
begin
  select cs.* into s from neas.client_sessions cs
  join neas.client_access_credentials cr on cr.id = cs.credential_id
  where cs.token_hash = encode(digest(p_token, 'sha256'), 'hex')
    and cs.revoked_at is null and cs.expires_at > now()
    and cr.revoked_at is null and (cr.expires_at is null or cr.expires_at > now());
  if not found then raise exception 'Session expired' using errcode = 'P0401'; end if;

  select * into p from neas.projects where id = s.project_id and client_portal_enabled and status in ('active', 'completed');
  if not found then raise exception 'Client access is closed for this project' using errcode = 'P0401'; end if;
  select * into c from neas.approved_client_content where project_id = p.id;
  update neas.client_sessions set last_seen_at = now() where id = s.id;

  result := jsonb_build_object(
    'project', jsonb_build_object('code', p.code, 'name', p.name, 'status', p.status) ||
      case when c.show_overview then jsonb_build_object('client', p.client_name, 'site', p.site, 'reference_no', p.reference_no, 'start_date', p.start_date, 'end_date', p.end_date) else '{}'::jsonb end,
    'visibility', to_jsonb(c) - 'project_id' - 'updated_by' - 'updated_at' - 'session_hours',
    'session_expires_at', s.expires_at,
    'generated_at', now()
  );
  if c.show_progress or c.show_gantt or c.show_scurve or c.show_milestones or c.show_completion then
    result := result || jsonb_build_object('activities', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'start_date', a.start_date, 'end_date', a.end_date,
        'weight', a.weight, 'is_milestone', a.is_milestone) order by a.start_date, a.sort_order)
      from neas.activities a where a.project_id = p.id and a.deleted_at is null and a.client_visible), '[]'::jsonb));
    -- actual progress comes from approved progress reports only
    result := result || jsonb_build_object('progress', coalesce((
      select jsonb_agg(jsonb_build_object('activity_id', r.activity_id, 'report_date', r.report_date, 'actual_pct', r.actual_pct) order by r.report_date, r.created_at)
      from neas.project_reports r join neas.activities a on a.id = r.activity_id
      where r.project_id = p.id and r.deleted_at is null and r.status = 'approved' and r.actual_pct is not null and a.client_visible), '[]'::jsonb));
  end if;
  if c.show_reports then
    result := result || jsonb_build_object('reports', coalesce((
      select jsonb_agg(jsonb_build_object('report_date', r.report_date, 'report_type', r.report_type, 'activity', a.name, 'actual_pct', r.actual_pct, 'notes', r.notes) order by r.report_date desc)
      from neas.project_reports r left join neas.activities a on a.id = r.activity_id
      where r.project_id = p.id and r.deleted_at is null and r.status = 'approved' and r.client_visible), '[]'::jsonb));
  end if;
  if c.show_photos or c.show_documents then
    result := result || jsonb_build_object('files', coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'kind', f.kind, 'caption', f.caption, 'storage_path', f.storage_path, 'mime_type', f.mime_type, 'created_at', f.created_at,
          'captured_at', f.captured_at, 'photo_ref', f.photo_ref, 'work_area', f.work_area, 'pair_id', f.pair_id,
          'is_cover', f.is_cover, 'cover_category', f.cover_category, 'cover_order', f.cover_order, 'cover_primary', f.cover_primary,
          'activity', (select a.name from neas.activities a where a.id = f.activity_id and a.project_id = p.id and a.deleted_at is null and a.client_visible)) ||
        -- recorded location only when the project allows clients to see photo locations
        case when c.show_photo_locations then jsonb_build_object('gps_lat', f.gps_lat, 'gps_lng', f.gps_lng, 'gps_accuracy_m', f.gps_accuracy_m,
          'gps_captured_at', f.gps_captured_at, 'gps_status', f.gps_status, 'gps_source', f.gps_source, 'location_detail', f.location_detail) else '{}'::jsonb end
        order by coalesce(f.captured_at, f.created_at) desc)
      from neas.report_attachments f
      left join neas.project_reports r on r.id = f.report_id
      where f.project_id = p.id and f.deleted_at is null and f.client_visible
        and (f.report_id is null or r.status = 'approved')
        and ((c.show_photos and f.kind <> 'document') or (c.show_documents and f.kind = 'document'))), '[]'::jsonb));
  end if;
  return result;
end $$;
