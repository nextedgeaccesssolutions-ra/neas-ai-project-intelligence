-- A Super Admin can give a client account more (or fewer) modules. It stays a client: every module is view only and
-- shows only what is shared with the client, because the data rules key on is_client, not on the module list.
create or replace function neas.admin_set_client_views(p_user uuid, p_views text[]) returns void
language plpgsql security definer set search_path = neas, extensions as $$
begin
  if not neas.is_super_admin() then raise exception 'Not authorized' using errcode = '42501'; end if;
  if not exists (select 1 from neas.profiles where id = p_user and is_client) then
    raise exception 'This is not a client account' using errcode = '22023';
  end if;
  update neas.profiles set allowed_views = coalesce(p_views, array[]::text[]) where id = p_user;
  perform neas.write_audit('account:views_changed', null, 'profiles', p_user::text,
    jsonb_build_object('views', to_jsonb(coalesce(p_views, array[]::text[])), 'client', true));
end $$;
revoke all on function neas.admin_set_client_views(uuid, text[]) from public, anon;
grant execute on function neas.admin_set_client_views(uuid, text[]) to authenticated;
