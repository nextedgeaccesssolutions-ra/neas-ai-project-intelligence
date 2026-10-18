-- Private bucket for project photos and documents. Object paths must start with the project UUID:
--   <project_id>/<attachment_id>.<ext>
-- Access follows project membership; clients receive short-lived signed URLs from the server only.

insert into storage.buckets (id, name, public)
values ('neas-project-files', 'neas-project-files', false)
on conflict (id) do nothing;

create or replace function neas.path_project(p_name text) returns uuid
language plpgsql immutable as $$
begin
  return split_part(p_name, '/', 1)::uuid;
exception when others then
  return null;
end $$;
grant execute on function neas.path_project(text) to authenticated;

drop policy if exists neas_files_select on storage.objects;
create policy neas_files_select on storage.objects for select to authenticated
  using (bucket_id = 'neas-project-files' and (neas.is_super_admin() or neas.is_member(neas.path_project(name))));

drop policy if exists neas_files_insert on storage.objects;
create policy neas_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'neas-project-files' and (neas.is_super_admin() or neas.is_member(neas.path_project(name))));

drop policy if exists neas_files_delete on storage.objects;
create policy neas_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'neas-project-files' and (neas.is_super_admin() or neas.is_manager(neas.path_project(name))));
