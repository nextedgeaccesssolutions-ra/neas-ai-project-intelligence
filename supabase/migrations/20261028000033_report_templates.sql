-- Report templates: each project has its own editable template(s); reports are filled in from a template.
-- Templates: Super Admin or the project's manager edit them. Reports: anyone on the project fills them in.
-- A template with no project is in the library and can be copied to any project.

create table if not exists neas.report_templates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references neas.projects (id) on delete cascade,
  name text not null check (length(btrim(name)) between 2 and 120),
  definition jsonb not null check (jsonb_typeof(definition) = 'object' and jsonb_typeof(definition -> 'sections') = 'array' and length(definition::text) <= 200000),
  created_at timestamptz not null default now(),
  updated_by uuid references neas.profiles (id),
  updated_at timestamptz not null default now()
);
create unique index if not exists report_templates_name on neas.report_templates (coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name)));

create table if not exists neas.template_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references neas.projects (id) on delete cascade,
  template_id uuid references neas.report_templates (id) on delete set null,
  title text not null check (length(btrim(title)) between 2 and 200),
  -- the template as it was when the report was started, so later template edits never change it
  definition jsonb not null check (jsonb_typeof(definition) = 'object'),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and length(data::text) <= 500000),
  status text not null default 'draft' check (status in ('draft', 'final')),
  created_by uuid not null default auth.uid() references neas.profiles (id),
  updated_by uuid references neas.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists template_reports_project on neas.template_reports (project_id, updated_at desc);

-- NEAS staff on the project: a member whose account is not a client account (Overview-only modules)
create or replace function neas.is_project_staff(p_project uuid) returns boolean
language sql stable security definer set search_path = neas, extensions as $$
  select neas.is_member(p_project) and exists (
    select 1 from neas.profiles p where p.id = auth.uid() and p.allowed_views is distinct from array['overview']::text[]);
$$;
revoke all on function neas.is_project_staff(uuid) from public, anon;
grant execute on function neas.is_project_staff(uuid) to authenticated, service_role;

alter table neas.report_templates enable row level security;
alter table neas.template_reports enable row level security;
revoke all on neas.report_templates, neas.template_reports from anon, authenticated;
grant select on neas.report_templates to authenticated;
grant select, insert, update, delete on neas.template_reports to authenticated;
grant all on neas.report_templates, neas.template_reports to service_role;

drop policy if exists report_templates_read on neas.report_templates;
create policy report_templates_read on neas.report_templates for select to authenticated
  using (neas.is_super_admin() or neas.is_project_staff(project_id)
         or (project_id is null and neas.is_active_user() and exists (select 1 from neas.profiles p where p.id = auth.uid() and p.allowed_views is distinct from array['overview']::text[])));

drop policy if exists template_reports_read on neas.template_reports;
create policy template_reports_read on neas.template_reports for select to authenticated
  using (neas.is_super_admin() or neas.is_project_staff(project_id));
drop policy if exists template_reports_insert on neas.template_reports;
create policy template_reports_insert on neas.template_reports for insert to authenticated
  with check ((neas.is_super_admin() or neas.is_project_staff(project_id)) and created_by = auth.uid() and status = 'draft');
drop policy if exists template_reports_update on neas.template_reports;
create policy template_reports_update on neas.template_reports for update to authenticated
  -- the person who started the report, or the project manager / a Super Admin
  using (neas.is_super_admin() or neas.is_manager(project_id) or (created_by = auth.uid() and neas.is_project_staff(project_id)))
  with check (neas.is_super_admin() or neas.is_manager(project_id) or (created_by = auth.uid() and neas.is_project_staff(project_id)));
drop policy if exists template_reports_delete on neas.template_reports;
create policy template_reports_delete on neas.template_reports for delete to authenticated
  using (neas.is_super_admin() or neas.is_manager(project_id) or (created_by = auth.uid() and status = 'draft'));

-- keep who/when, never let a report move to another project, and only managers mark a report final
create or replace function neas.guard_template_report() returns trigger
language plpgsql security definer set search_path = neas, extensions as $$
begin
  if tg_op = 'UPDATE' then
    if new.project_id is distinct from old.project_id or new.created_by is distinct from old.created_by then
      raise exception 'A report cannot move to another project' using errcode = '42501';
    end if;
    if new.status is distinct from old.status and not (neas.is_super_admin() or neas.is_manager(new.project_id)) then
      raise exception 'Only the project manager or a Super Admin can finalise a report' using errcode = '42501';
    end if;
    if old.status = 'final' and not (neas.is_super_admin() or neas.is_manager(new.project_id)) then
      raise exception 'This report is final. Ask the project manager to reopen it.' using errcode = '42501';
    end if;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists guard_template_report on neas.template_reports;
create trigger guard_template_report before insert or update on neas.template_reports for each row execute function neas.guard_template_report();
revoke execute on function neas.guard_template_report() from public, anon, authenticated;

create or replace function neas.save_report_template(p_id uuid, p_project uuid, p_name text, p_definition jsonb)
returns uuid language plpgsql security definer set search_path = neas, extensions as $$
declare tid uuid := p_id; cur neas.report_templates%rowtype;
begin
  if p_id is not null then
    select * into cur from neas.report_templates where id = p_id for update;
    if not found then raise exception 'Template not found' using errcode = 'P0002'; end if;
    p_project := cur.project_id;
  end if;
  if not (neas.is_super_admin() or (p_project is not null and neas.is_manager(p_project))) then
    raise exception 'Only a Super Admin or the project manager can change report templates' using errcode = '42501';
  end if;
  if jsonb_typeof(p_definition) is distinct from 'object' or jsonb_typeof(p_definition -> 'sections') is distinct from 'array'
     or (p_definition ? 'cover' and jsonb_typeof(p_definition -> 'cover') <> 'array') then
    raise exception 'Invalid template' using errcode = '22023';
  end if;
  begin
    if p_id is null then
      insert into neas.report_templates (project_id, name, definition, updated_by) values (p_project, btrim(p_name), p_definition, auth.uid()) returning id into tid;
    else
      update neas.report_templates set name = btrim(p_name), definition = p_definition, updated_by = auth.uid(), updated_at = now() where id = p_id;
    end if;
  exception when unique_violation then
    raise exception 'A template with that name already exists for this project' using errcode = '23505';
  end;
  insert into neas.audit_logs (actor_id, action, project_id, target_type, target_id, details)
    values (auth.uid(), 'report:template_saved', p_project, 'report_templates', tid::text, jsonb_build_object('name', btrim(p_name)));
  return tid;
end $$;

create or replace function neas.delete_report_template(p_id uuid)
returns void language plpgsql security definer set search_path = neas, extensions as $$
declare cur neas.report_templates%rowtype;
begin
  select * into cur from neas.report_templates where id = p_id;
  if not found then raise exception 'Template not found' using errcode = 'P0002'; end if;
  if not (neas.is_super_admin() or (cur.project_id is not null and neas.is_manager(cur.project_id))) then
    raise exception 'Only a Super Admin or the project manager can remove report templates' using errcode = '42501';
  end if;
  delete from neas.report_templates where id = p_id;  -- reports keep their own copy of the template
  insert into neas.audit_logs (actor_id, action, project_id, target_type, target_id, details)
    values (auth.uid(), 'report:template_removed', cur.project_id, 'report_templates', p_id::text, jsonb_build_object('name', cur.name));
end $$;

revoke all on function neas.save_report_template(uuid, uuid, text, jsonb) from public, anon;
grant execute on function neas.save_report_template(uuid, uuid, text, jsonb) to authenticated, service_role;
revoke all on function neas.delete_report_template(uuid) from public, anon;
grant execute on function neas.delete_report_template(uuid) to authenticated, service_role;

-- seed: the NEAS quarterly mast inspection template in the library, and a copy for Triconti (NEAS-0056-1-26)
insert into neas.report_templates (project_id, name, definition)
select null, 'Quarterly mast inspection (NEAS)', '{"title": "Quarterly Wind Measuring Mast Inspection & Preventive Maintenance Report", "division": "NEAS | Wind Resource Assessment Division", "cover": [{"key": "period_label", "label": "Quarter (e.g. Q2 - April to June 2025)"}, {"key": "location", "label": "Location"}, {"key": "mast", "label": "Mast"}, {"key": "inspection_period", "label": "Inspection period"}, {"key": "report_date", "label": "Report date"}, {"key": "team", "label": "Inspection team"}, {"key": "prepared_by", "label": "Prepared by", "default": "NextEdge Access Solutions (NEAS)"}], "sections": [{"id": "summary", "title": "Executive Summary", "kind": "text"}, {"id": "status", "title": "Status at a glance", "kind": "status", "items": ["Overall condition", "Maintenance required", "Guy-wire adjustment", "Sensor status"]}, {"id": "highlights", "title": "Management Highlights", "kind": "bullets"}, {"id": "findings", "title": "Inspection Findings & Compliance Matrix", "kind": "table", "columns": ["Inspection Element", "Evidence / Check", "Action / Result", "Status"], "rows": [["Vertical alignment of mast/sensors", "", "", ""], ["Guy-wire tension & alignment", "", "", ""], ["Anchors & foundations", "", "", ""], ["Boom direction/orientation", "", "", ""], ["Mast cables", "", "", ""], ["Bolts & nuts", "", "", ""], ["Lightning protection", "", "", ""], ["Measuring equipment", "", "", ""], ["Steel cabinet / logger system", "", "", ""], ["Corrosion control", "", "", ""], ["Ground / vegetation clearance", "", "", ""]]}, {"id": "activities", "title": "Maintenance Activity Summary", "kind": "table", "columns": ["Activity", "Area / Scope", "Work Performed", "Close-Out"], "rows": [["Minor corrosion treatment", "Guy wires / anchors / steelwork", "", ""], ["Vegetation control", "Mast and anchor vicinity", "", ""], ["Guy-wire system check", "Guy-wire orientations (3)", "", ""], ["Boom alignment check", "Side booms / top structure", "", ""], ["Cabling inspection", "Lightning and sensor cables", "", ""], ["Control / data equipment", "Logger, OVPs, terminals, battery, controller", "", ""]]}, {"id": "charts", "title": "Summary Chart Reports", "kind": "text"}, {"id": "recommendations", "title": "Recommendations & Forward Maintenance Plan", "kind": "table", "columns": ["ID", "Recommendation", "Rationale", "Timing", "Type", "Priority"], "rows": [["R-01", "Continue Quarterly Visual Inspections", "", "", "", ""], ["R-02", "Corrosion Monitoring & Preventive Repainting", "", "", "", ""], ["R-03", "Maintain Vegetation Clearance", "", "", "", ""], ["R-04", "Monitor Adjacent Construction Activity", "", "", "", ""], ["R-05", "Standardize Photo Documentation", "", "", "", ""], ["R-06", "Equipment Condition Trending", "", "", "", ""]]}, {"id": "conclusion", "title": "Conclusion", "kind": "text"}, {"id": "approval", "title": "Report Approval & Record", "kind": "table", "columns": ["Role", "Name / Designation", "Signature / Date"], "rows": [["Inspection Team", "", ""], ["Prepared / Reviewed", "NextEdge Access Solutions (NEAS)", ""], ["Client Representative", "To be completed by client", ""]]}, {"id": "photos", "title": "Annex A - Photographic Record", "kind": "photos"}, {"id": "traceability", "title": "Annex B - Source Record Traceability", "kind": "table", "columns": ["Field", "Detail"], "rows": [["Inspection Date & Time", ""], ["Location", ""], ["Inspection Team", ""], ["Measurement Start", ""], ["Overall Condition", ""], ["Adjacent Construction", ""], ["Photo Annex Coverage", ""]]}]}'::jsonb
where not exists (select 1 from neas.report_templates where project_id is null and lower(name) = lower('Quarterly mast inspection (NEAS)'));
insert into neas.report_templates (project_id, name, definition)
select p.id, 'Triconti quarterly mast inspection', '{"title": "Quarterly Wind Measuring Mast Inspection & Preventive Maintenance Report", "division": "NEAS | Wind Resource Assessment Division", "cover": [{"key": "period_label", "label": "Quarter (e.g. Q2 - April to June 2025)"}, {"key": "location", "label": "Location"}, {"key": "mast", "label": "Mast"}, {"key": "inspection_period", "label": "Inspection period"}, {"key": "report_date", "label": "Report date"}, {"key": "team", "label": "Inspection team"}, {"key": "prepared_by", "label": "Prepared by", "default": "NextEdge Access Solutions (NEAS)"}], "sections": [{"id": "summary", "title": "Executive Summary", "kind": "text"}, {"id": "status", "title": "Status at a glance", "kind": "status", "items": ["Overall condition", "Maintenance required", "Guy-wire adjustment", "Sensor status"]}, {"id": "highlights", "title": "Management Highlights", "kind": "bullets"}, {"id": "findings", "title": "Inspection Findings & Compliance Matrix", "kind": "table", "columns": ["Inspection Element", "Evidence / Check", "Action / Result", "Status"], "rows": [["Vertical alignment of mast/sensors", "", "", ""], ["Guy-wire tension & alignment", "", "", ""], ["Anchors & foundations", "", "", ""], ["Boom direction/orientation", "", "", ""], ["Mast cables", "", "", ""], ["Bolts & nuts", "", "", ""], ["Lightning protection", "", "", ""], ["Measuring equipment", "", "", ""], ["Steel cabinet / logger system", "", "", ""], ["Corrosion control", "", "", ""], ["Ground / vegetation clearance", "", "", ""]]}, {"id": "activities", "title": "Maintenance Activity Summary", "kind": "table", "columns": ["Activity", "Area / Scope", "Work Performed", "Close-Out"], "rows": [["Minor corrosion treatment", "Guy wires / anchors / steelwork", "", ""], ["Vegetation control", "Mast and anchor vicinity", "", ""], ["Guy-wire system check", "Guy-wire orientations (3)", "", ""], ["Boom alignment check", "Side booms / top structure", "", ""], ["Cabling inspection", "Lightning and sensor cables", "", ""], ["Control / data equipment", "Logger, OVPs, terminals, battery, controller", "", ""]]}, {"id": "charts", "title": "Summary Chart Reports", "kind": "text"}, {"id": "recommendations", "title": "Recommendations & Forward Maintenance Plan", "kind": "table", "columns": ["ID", "Recommendation", "Rationale", "Timing", "Type", "Priority"], "rows": [["R-01", "Continue Quarterly Visual Inspections", "", "", "", ""], ["R-02", "Corrosion Monitoring & Preventive Repainting", "", "", "", ""], ["R-03", "Maintain Vegetation Clearance", "", "", "", ""], ["R-04", "Monitor Adjacent Construction Activity", "", "", "", ""], ["R-05", "Standardize Photo Documentation", "", "", "", ""], ["R-06", "Equipment Condition Trending", "", "", "", ""]]}, {"id": "conclusion", "title": "Conclusion", "kind": "text"}, {"id": "approval", "title": "Report Approval & Record", "kind": "table", "columns": ["Role", "Name / Designation", "Signature / Date"], "rows": [["Inspection Team", "", ""], ["Prepared / Reviewed", "NextEdge Access Solutions (NEAS)", ""], ["Client Representative", "To be completed by client", ""]]}, {"id": "photos", "title": "Annex A - Photographic Record", "kind": "photos"}, {"id": "traceability", "title": "Annex B - Source Record Traceability", "kind": "table", "columns": ["Field", "Detail"], "rows": [["Inspection Date & Time", ""], ["Location", ""], ["Inspection Team", ""], ["Measurement Start", ""], ["Overall Condition", ""], ["Adjacent Construction", ""], ["Photo Annex Coverage", ""]]}]}'::jsonb from neas.projects p
where p.code = 'NEAS-0056-1-26'
  and not exists (select 1 from neas.report_templates t where t.project_id = p.id and lower(t.name) = lower('Triconti quarterly mast inspection'));
