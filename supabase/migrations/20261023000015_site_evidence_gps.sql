-- Site evidence: capture time, GPS metadata, work-area location, photo types and before/after pairing.
-- GPS is the device-reported position (with its accuracy), never invented: status says how it was obtained.

alter table neas.report_attachments
  add column if not exists captured_at timestamptz,
  add column if not exists gps_lat numeric(9, 6),
  add column if not exists gps_lng numeric(9, 6),
  add column if not exists gps_accuracy_m numeric(10, 2),
  add column if not exists gps_altitude_m numeric(10, 2),
  add column if not exists gps_heading numeric(6, 2),
  add column if not exists gps_captured_at timestamptz,
  add column if not exists gps_status text not null default 'not_requested',
  add column if not exists work_area text not null default '',
  add column if not exists location_detail text not null default '',
  add column if not exists pair_id uuid,
  add column if not exists photo_ref text not null default '';

do $$
declare c record;
begin
  for c in select conname from pg_constraint
    where conrelid = 'neas.report_attachments'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%kind%'
  loop
    execute format('alter table neas.report_attachments drop constraint %I', c.conname);
  end loop;
  alter table neas.report_attachments add constraint report_attachments_kind_check
    check (kind in ('before', 'during', 'after', 'inspection', 'safety', 'defect', 'document'));

  if not exists (select 1 from pg_constraint where conname = 'report_attachments_gps_check') then
    alter table neas.report_attachments add constraint report_attachments_gps_check check (
      gps_status in ('captured', 'manual', 'unavailable', 'denied', 'not_requested')
      and (gps_lat is null or gps_lat between -90 and 90)
      and (gps_lng is null or gps_lng between -180 and 180)
      and (gps_accuracy_m is null or gps_accuracy_m >= 0)
      and (gps_heading is null or (gps_heading >= 0 and gps_heading < 360))
      and ((gps_status in ('captured', 'manual')) = (gps_lat is not null and gps_lng is not null))
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'report_attachments_text_len_check') then
    alter table neas.report_attachments add constraint report_attachments_text_len_check
      check (length(work_area) <= 200 and length(location_detail) <= 300 and length(photo_ref) <= 60);
  end if;
end $$;

create index if not exists report_attachments_pair_idx on neas.report_attachments (pair_id) where pair_id is not null;

-- Uploads use upsert, which needs UPDATE on the object (same rule as insert).
drop policy if exists neas_files_update on storage.objects;
create policy neas_files_update on storage.objects for update to authenticated
  using (bucket_id = 'neas-project-files' and (neas.is_super_admin() or neas.is_member(neas.path_project(name))))
  with check (bucket_id = 'neas-project-files' and (neas.is_super_admin() or neas.is_member(neas.path_project(name))));
