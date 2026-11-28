-- Client accounts open every module by default. They still cannot edit or submit anything and see only items shared
-- with the client: those rules key on is_client in the database, not on the module list.
update neas.profiles set allowed_views = null where is_client;

create or replace function neas.admin_set_client(p_user uuid, p_client boolean) returns void
language plpgsql security definer set search_path = neas, extensions as $$
begin
  if not neas.is_super_admin() then raise exception 'Not authorized' using errcode = '42501'; end if;
  if exists (select 1 from neas.profiles where id = p_user and global_role = 'super_admin') and p_client then
    raise exception 'A Super Admin cannot be a client account' using errcode = '22023';
  end if;
  update neas.profiles set is_client = p_client, allowed_views = null where id = p_user;
  if not found then raise exception 'User not found'; end if;
  if p_client then update neas.project_memberships set can_approve_reports = false, role = 'employee' where user_id = p_user; end if;
  perform neas.write_audit(case when p_client then 'account:made_client' else 'account:made_staff' end, null, 'profiles', p_user::text, '{}'::jsonb);
end $$;
