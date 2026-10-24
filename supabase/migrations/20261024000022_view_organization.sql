-- View organisation for long lists (site evidence photos, report library): saved groups and
-- personal hidden items. These rows only change how lists are displayed. They never move, rename,
-- delete or re-permission a file or report, and every read still passes the files' own RLS.

create table if not exists neas.view_groups (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references neas.projects (id) on delete cascade,
  list_key text not null check (list_key in ('evidence', 'reports')),
  -- personal: only the owner sees it; project: everyone on the project sees it, managers edit it
  scope text not null check (scope in ('personal', 'project')),
  owner_id uuid not null default auth.uid() references neas.profiles (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists view_groups_unique_name on neas.view_groups
  (project_id, list_key, scope, (case when scope = 'personal' then owner_id end), lower(btrim(name)));
create index if not exists view_groups_project on neas.view_groups (project_id, list_key);

create table if not exists neas.view_group_items (
  group_id uuid not null references neas.view_groups (id) on delete cascade,
  item_kind text not null check (item_kind in ('attachment', 'field_report', 'project_export')),
  item_id uuid not null,
  project_id uuid not null,
  -- one group per item per view (a person's own view, or the shared project view)
  scope_key text not null,
  added_by uuid default auth.uid(),
  added_at timestamptz not null default now(),
  primary key (group_id, item_kind, item_id),
  unique (scope_key, item_kind, item_id)
);
create index if not exists view_group_items_item on neas.view_group_items (item_kind, item_id);

create table if not exists neas.hidden_items (
  user_id uuid not null default auth.uid() references neas.profiles (id) on delete cascade,
  project_id uuid not null references neas.projects (id) on delete cascade,
  item_kind text not null check (item_kind in ('attachment', 'field_report', 'project_export')),
  item_id uuid not null,
  hidden_at timestamptz not null default now(),
  primary key (user_id, item_kind, item_id)
);

create or replace function neas.can_edit_view_group(p_scope text, p_owner uuid, p_project uuid)
returns boolean language sql stable security definer set search_path = neas, extensions as $$
  select case
    when p_scope = 'personal' then p_owner = auth.uid() and (neas.is_super_admin() or neas.is_member(p_project))
    else neas.is_super_admin() or neas.is_manager(p_project)
  end;
$$;

-- the item must exist in the same project, and suit the list the group belongs to
create or replace function neas.view_item_project(p_kind text, p_item uuid)
returns uuid language sql stable security definer set search_path = neas, extensions as $$
  select case p_kind
    when 'attachment' then (select project_id from neas.report_attachments where id = p_item)
    when 'field_report' then (select project_id from neas.project_reports where id = p_item)
    when 'project_export' then (select project_id from neas.project_report_exports where id = p_item)
  end;
$$;
revoke execute on function neas.view_item_project(text, uuid) from public, anon;

create or replace function neas.guard_view_group_item() returns trigger
language plpgsql security definer set search_path = neas, extensions as $$
declare g neas.view_groups%rowtype;
begin
  select * into g from neas.view_groups where id = new.group_id;
  if not found then raise exception 'Group not found' using errcode = 'P0002'; end if;
  if (g.list_key = 'evidence') <> (new.item_kind = 'attachment') then
    raise exception 'This item does not belong in this list' using errcode = '22023';
  end if;
  if neas.view_item_project(new.item_kind, new.item_id) is distinct from g.project_id then
    raise exception 'Items can only be grouped within their own project' using errcode = '22023';
  end if;
  new.project_id := g.project_id;
  new.scope_key := case when g.scope = 'personal' then 'u:' || g.owner_id::text else 'p:' || g.project_id::text end || ':' || g.list_key;
  return new;
end $$;
drop trigger if exists guard_view_group_item on neas.view_group_items;
create trigger guard_view_group_item before insert or update on neas.view_group_items for each row execute function neas.guard_view_group_item();

create or replace function neas.touch_view_group() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.owner_id := old.owner_id; new.project_id := old.project_id; new.list_key := old.list_key; new.scope := old.scope;
  return new;
end $$;
drop trigger if exists touch_view_group on neas.view_groups;
create trigger touch_view_group before update on neas.view_groups for each row execute function neas.touch_view_group();

create or replace function neas.guard_hidden_item() returns trigger
language plpgsql security definer set search_path = neas, extensions as $$
begin
  if neas.view_item_project(new.item_kind, new.item_id) is distinct from new.project_id then
    raise exception 'Item not found in this project' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists guard_hidden_item on neas.hidden_items;
create trigger guard_hidden_item before insert or update on neas.hidden_items for each row execute function neas.guard_hidden_item();

alter table neas.view_groups enable row level security;
alter table neas.view_group_items enable row level security;
alter table neas.hidden_items enable row level security;
revoke all on neas.view_groups, neas.view_group_items, neas.hidden_items from anon;
grant select, insert, update, delete on neas.view_groups, neas.view_group_items, neas.hidden_items to authenticated;
grant all on neas.view_groups, neas.view_group_items, neas.hidden_items to service_role;

drop policy if exists view_groups_select on neas.view_groups;
create policy view_groups_select on neas.view_groups for select to authenticated
  using ((scope = 'personal' and owner_id = auth.uid()) or (scope = 'project' and (neas.is_super_admin() or neas.is_member(project_id))));
drop policy if exists view_groups_insert on neas.view_groups;
create policy view_groups_insert on neas.view_groups for insert to authenticated
  with check (owner_id = auth.uid() and neas.can_edit_view_group(scope, owner_id, project_id));
drop policy if exists view_groups_update on neas.view_groups;
create policy view_groups_update on neas.view_groups for update to authenticated
  using (neas.can_edit_view_group(scope, owner_id, project_id)) with check (neas.can_edit_view_group(scope, owner_id, project_id));
drop policy if exists view_groups_delete on neas.view_groups;
create policy view_groups_delete on neas.view_groups for delete to authenticated
  using (neas.can_edit_view_group(scope, owner_id, project_id));

drop policy if exists view_group_items_select on neas.view_group_items;
create policy view_group_items_select on neas.view_group_items for select to authenticated
  using (exists (select 1 from neas.view_groups g where g.id = group_id));
drop policy if exists view_group_items_write on neas.view_group_items;
create policy view_group_items_write on neas.view_group_items for all to authenticated
  using (exists (select 1 from neas.view_groups g where g.id = group_id and neas.can_edit_view_group(g.scope, g.owner_id, g.project_id)))
  with check (exists (select 1 from neas.view_groups g where g.id = group_id and neas.can_edit_view_group(g.scope, g.owner_id, g.project_id)));

drop policy if exists hidden_items_own on neas.hidden_items;
create policy hidden_items_own on neas.hidden_items for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and (neas.is_super_admin() or neas.is_member(project_id)));

drop trigger if exists audit_view_groups on neas.view_groups;
create trigger audit_view_groups after insert or update or delete on neas.view_groups for each row execute function neas.audit_row();

-- Move items into a group in one step: they leave any other group of the same view first,
-- so a failure never leaves an item in two places. Runs as the caller (RLS applies).
create or replace function neas.move_items_to_group(p_group uuid, p_kind text, p_ids uuid[])
returns integer language plpgsql security invoker set search_path = neas, extensions as $$
declare
  g neas.view_groups%rowtype;
  k text;
  n integer;
begin
  if coalesce(array_length(p_ids, 1), 0) = 0 then return 0; end if;
  if array_length(p_ids, 1) > 500 then raise exception 'Select at most 500 items at a time' using errcode = '22023'; end if;
  select * into g from neas.view_groups where id = p_group;
  if not found or not neas.can_edit_view_group(g.scope, g.owner_id, g.project_id) then
    raise exception 'You cannot change this group' using errcode = '42501';
  end if;
  k := case when g.scope = 'personal' then 'u:' || g.owner_id::text else 'p:' || g.project_id::text end || ':' || g.list_key;
  delete from neas.view_group_items where scope_key = k and item_kind = p_kind and item_id = any (p_ids);
  insert into neas.view_group_items (group_id, item_kind, item_id, project_id, scope_key)
  select p_group, p_kind, x, g.project_id, k from (select distinct unnest(p_ids) x) s;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function neas.move_items_to_group(uuid, text, uuid[]) from public, anon;
grant execute on function neas.move_items_to_group(uuid, text, uuid[]) to authenticated;
