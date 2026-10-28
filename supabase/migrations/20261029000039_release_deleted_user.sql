-- "Delete forever" for an account that is already deleted: its e-mail and username are released so a new account can
-- be created with the same details. The record itself stays (renamed, never usable again) so reports, photos and the
-- audit log keep their author; deleting the row would cascade through or orphan that history.
create or replace function neas.admin_release_deleted_user(p_user uuid) returns text
language plpgsql security definer set search_path = neas, extensions as $$
declare prof neas.profiles; placeholder text;
begin
  if not neas.is_super_admin() then raise exception 'Not authorized' using errcode = '42501'; end if;
  select * into prof from neas.profiles where id = p_user for update;
  if not found then raise exception 'User not found'; end if;
  if prof.deleted_at is null then raise exception 'Delete the account first, then delete it forever' using errcode = '22023'; end if;
  placeholder := 'removed-' || replace(p_user::text, '-', '') || '@users.neas.invalid';
  update neas.profiles set email = placeholder, username = null, is_client = false, allowed_views = null,
    status = 'suspended', status_reason = 'Deleted forever by administrator',
    full_name = case when coalesce(full_name, '') = '' or full_name like '%(removed)' then coalesce(nullif(full_name, ''), 'Removed user') else full_name || ' (removed)' end
  where id = p_user;
  perform neas.write_audit('account:deleted_forever', null, 'profiles', p_user::text,
    jsonb_build_object('released_email', prof.email, 'released_username', prof.username));
  return placeholder;
end $$;
revoke all on function neas.admin_release_deleted_user(uuid) from public, anon;
grant execute on function neas.admin_release_deleted_user(uuid) to authenticated;
