-- Site Evidence: where each location came from, required photo counts per scope, and client access
-- to recorded photo locations (on by default, switchable per project in Client viewer access).

alter table neas.report_attachments add column if not exists gps_source text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'report_attachments_gps_source_check') then
    alter table neas.report_attachments add constraint report_attachments_gps_source_check
      check (gps_source is null or gps_source in ('exif', 'device', 'manual'));
  end if;
end $$;
-- the only source that can be known for existing rows: manually entered positions
update neas.report_attachments set gps_source = 'manual' where gps_status = 'manual' and gps_source is null;

alter table neas.activities add column if not exists required_photos smallint;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'activities_required_photos_check') then
    alter table neas.activities add constraint activities_required_photos_check check (required_photos is null or required_photos between 0 and 500);
  end if;
end $$;

alter table neas.approved_client_content add column if not exists show_photo_locations boolean not null default true;

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
