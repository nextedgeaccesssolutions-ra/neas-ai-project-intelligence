-- Saved groups and personal hiding for more lists: project register and portfolio, schedule
-- activities and the Overview action center, field reports, BOQ lines and the project-report history.
-- Display only, as in migration 000022: no file, record or permission ever changes.

alter table neas.view_groups drop constraint if exists view_groups_list_key_check;
alter table neas.view_groups add constraint view_groups_list_key_check
  check (list_key in ('evidence', 'reports', 'projects', 'activities', 'actions', 'field_reports', 'boq', 'report_history'));
alter table neas.view_group_items drop constraint if exists view_group_items_item_kind_check;
alter table neas.view_group_items add constraint view_group_items_item_kind_check
  check (item_kind in ('attachment', 'field_report', 'project_export', 'project', 'activity', 'boq_line'));
alter table neas.hidden_items drop constraint if exists hidden_items_item_kind_check;
alter table neas.hidden_items add constraint hidden_items_item_kind_check
  check (item_kind in ('attachment', 'field_report', 'project_export', 'project', 'activity', 'boq_line'));

-- groups of projects span projects, so they belong to no project and are always personal
-- (the name index treats a missing project as one value, so names stay unique per person)
drop index if exists neas.view_groups_unique_name;
create unique index if not exists view_groups_unique_name on neas.view_groups
  (coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid), list_key, scope, (case when scope = 'personal' then owner_id end), lower(btrim(name)));
alter table neas.view_groups alter column project_id drop not null;
alter table neas.view_group_items alter column project_id drop not null;
alter table neas.view_groups drop constraint if exists view_groups_project_scope;
alter table neas.view_groups add constraint view_groups_project_scope
  check ((list_key = 'projects') = (project_id is null) and (project_id is not null or scope = 'personal'));

create or replace function neas.can_edit_view_group(p_scope text, p_owner uuid, p_project uuid)
returns boolean language sql stable security definer set search_path = neas, extensions as $$
  select case
    when p_scope = 'personal' and p_project is null then p_owner = auth.uid() and neas.is_active_user()
    when p_scope = 'personal' then p_owner = auth.uid() and (neas.is_super_admin() or neas.is_member(p_project))
    else neas.is_super_admin() or neas.is_manager(p_project)
  end;
$$;

create or replace function neas.view_item_project(p_kind text, p_item uuid)
returns uuid language sql stable security definer set search_path = neas, extensions as $$
  select case p_kind
    when 'attachment' then (select project_id from neas.report_attachments where id = p_item)
    when 'field_report' then (select project_id from neas.project_reports where id = p_item)
    when 'project_export' then (select project_id from neas.project_report_exports where id = p_item)
    when 'project' then (select id from neas.projects where id = p_item)
    when 'activity' then (select project_id from neas.activities where id = p_item)
    when 'boq_line' then (select project_id from neas.boq_lines where id = p_item)
  end;
$$;

-- which item kinds each list holds
create or replace function neas.view_list_accepts(p_list text, p_kind text)
returns boolean language sql immutable as $$
  select case p_list
    when 'evidence' then p_kind = 'attachment'
    when 'reports' then p_kind in ('field_report', 'project_export')
    when 'projects' then p_kind = 'project'
    when 'activities' then p_kind = 'activity'
    when 'actions' then p_kind = 'activity'
    when 'field_reports' then p_kind = 'field_report'
    when 'boq' then p_kind = 'boq_line'
    when 'report_history' then p_kind = 'project_export'
    else false
  end;
$$;

create or replace function neas.guard_view_group_item() returns trigger
language plpgsql security definer set search_path = neas, extensions as $$
declare
  g neas.view_groups%rowtype;
  item_project uuid;
begin
  select * into g from neas.view_groups where id = new.group_id;
  if not found then raise exception 'Group not found' using errcode = 'P0002'; end if;
  if not neas.view_list_accepts(g.list_key, new.item_kind) then
    raise exception 'This item does not belong in this list' using errcode = '22023';
  end if;
  item_project := neas.view_item_project(new.item_kind, new.item_id);
  if g.project_id is null then
    -- a project in a personal group of projects: it must exist and the person must be on it
    if item_project is null or not (neas.is_super_admin() or neas.is_member(item_project)) then
      raise exception 'Item not found' using errcode = '22023';
    end if;
  elsif item_project is distinct from g.project_id then
    raise exception 'Items can only be grouped within their own project' using errcode = '22023';
  end if;
  new.project_id := item_project;
  new.scope_key := case when g.scope = 'personal' then 'u:' || g.owner_id::text else 'p:' || g.project_id::text end || ':' || g.list_key;
  return new;
end $$;

revoke execute on function neas.view_list_accepts(text, text) from public, anon;
grant execute on function neas.view_list_accepts(text, text) to authenticated, service_role;
revoke execute on function neas.view_item_project(text, uuid) from public, anon, authenticated;
grant execute on function neas.view_item_project(text, uuid) to service_role;
revoke execute on function neas.can_edit_view_group(text, uuid, uuid) from public, anon;
grant execute on function neas.can_edit_view_group(text, uuid, uuid) to authenticated, service_role;
revoke execute on function neas.guard_view_group_item() from public, anon, authenticated;
