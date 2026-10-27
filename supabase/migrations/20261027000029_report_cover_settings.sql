-- Editable project-report cover page, per project.
-- values: per-line text that replaces the project-register value on the cover (any project member).
-- layout: report title, line labels, which lines show and their order, extra lines (Super Admin only).
-- Applies to reports generated after the change; earlier PDFs are never altered.

create table if not exists neas.report_cover_settings (
  project_id uuid primary key references neas.projects (id) on delete cascade,
  cover_values jsonb not null default '{}'::jsonb check (jsonb_typeof(cover_values) = 'object' and length(cover_values::text) <= 20000),
  layout jsonb not null default '{}'::jsonb check (jsonb_typeof(layout) = 'object' and length(layout::text) <= 20000),
  updated_by uuid references neas.profiles (id),
  updated_at timestamptz not null default now()
);
alter table neas.report_cover_settings enable row level security;
revoke all on neas.report_cover_settings from anon, authenticated;
grant select on neas.report_cover_settings to authenticated;
grant all on neas.report_cover_settings to service_role;
drop policy if exists report_cover_settings_read on neas.report_cover_settings;
create policy report_cover_settings_read on neas.report_cover_settings for select to authenticated
  using (neas.is_super_admin() or neas.is_member(project_id));

create or replace function neas.save_report_cover_values(p_project uuid, p_values jsonb)
returns void language plpgsql security definer set search_path = neas, extensions as $$
begin
  if not (neas.is_super_admin() or neas.is_member(p_project)) then raise exception 'Not authorized' using errcode = '42501'; end if;
  if jsonb_typeof(p_values) <> 'object' or length(p_values::text) > 20000 then raise exception 'Invalid cover details' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_each(p_values) e where jsonb_typeof(e.value) <> 'string' or length(e.value #>> '{}') > 300 or length(e.key) > 80) then
    raise exception 'Each cover line is text of at most 300 characters' using errcode = '22023';
  end if;
  insert into neas.report_cover_settings (project_id, cover_values, updated_by) values (p_project, p_values, auth.uid())
  on conflict (project_id) do update set cover_values = excluded.cover_values, updated_by = auth.uid(), updated_at = now();
  insert into neas.audit_logs (actor_id, action, project_id, target_type, target_id, details)
    values (auth.uid(), 'report:cover_values_saved', p_project, 'report_cover_settings', p_project::text, jsonb_build_object('lines', (select count(*) from jsonb_object_keys(p_values))));
end $$;

create or replace function neas.save_report_cover_layout(p_project uuid, p_layout jsonb)
returns void language plpgsql security definer set search_path = neas, extensions as $$
begin
  if not neas.is_super_admin() then raise exception 'Only a Super Admin can change the cover layout' using errcode = '42501'; end if;
  if not exists (select 1 from neas.projects where id = p_project) then raise exception 'Project not found' using errcode = 'P0002'; end if;
  if jsonb_typeof(p_layout) <> 'object' or length(p_layout::text) > 20000 then raise exception 'Invalid cover layout' using errcode = '22023'; end if;
  insert into neas.report_cover_settings (project_id, layout, updated_by) values (p_project, p_layout, auth.uid())
  on conflict (project_id) do update set layout = excluded.layout, updated_by = auth.uid(), updated_at = now();
  insert into neas.audit_logs (actor_id, action, project_id, target_type, target_id)
    values (auth.uid(), 'report:cover_layout_saved', p_project, 'report_cover_settings', p_project::text);
end $$;

revoke all on function neas.save_report_cover_values(uuid, jsonb) from public, anon;
grant execute on function neas.save_report_cover_values(uuid, jsonb) to authenticated, service_role;
revoke all on function neas.save_report_cover_layout(uuid, jsonb) from public, anon;
grant execute on function neas.save_report_cover_layout(uuid, jsonb) to authenticated, service_role;
