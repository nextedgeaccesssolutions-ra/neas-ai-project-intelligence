-- A Super Admin gives a client username login a new 6-digit passcode. This also restores a login that
-- was revoked (for example by an earlier "revoke existing passcodes"), as long as nobody else has
-- taken the username since. Open sessions of that login end, so the old passcode stops working at once.

create or replace function neas.admin_reset_client_login(p_credential uuid, p_passcode text)
returns text language plpgsql security definer set search_path = neas, extensions as $$
declare c neas.client_access_credentials%rowtype;
begin
  if not neas.is_super_admin() then raise exception 'Only a Super Admin can reset a client login' using errcode = '42501'; end if;
  if p_passcode !~ '^\d{6}$' then raise exception 'The passcode must be exactly 6 digits.' using errcode = '22023'; end if;
  select * into c from neas.client_access_credentials where id = p_credential for update;
  if not found or c.username is null then raise exception 'Client login not found' using errcode = 'P0002'; end if;
  if c.revoked_at is not null and (
       exists (select 1 from neas.client_access_credentials x where x.username = c.username and x.revoked_at is null and x.id <> c.id)
       or exists (select 1 from neas.profiles where username = c.username)) then
    raise exception 'That username is now used by someone else. Create a new client login instead.' using errcode = '23505';
  end if;
  update neas.client_access_credentials
     set passcode_hash = crypt(p_passcode, gen_salt('bf', 10)), revoked_at = null, expires_at = null, use_count = 0, max_uses = null
   where id = c.id;
  update neas.client_sessions set revoked_at = now() where credential_id = c.id and revoked_at is null;
  -- earlier wrong passcodes no longer count against the client
  delete from neas.client_login_attempts where project_code = 'U:' || c.username and not success;
  delete from neas.pin_login_attempts where username = c.username and not ok;
  insert into neas.audit_logs (actor_id, action, project_id, target_type, target_id, details)
    values (auth.uid(), 'client:login_reset', c.project_id, 'client_access_credentials', c.id::text, jsonb_build_object('username', c.username, 'restored', c.revoked_at is not null));
  return c.username;
end $$;

revoke all on function neas.admin_reset_client_login(uuid, text) from public, anon;
grant execute on function neas.admin_reset_client_login(uuid, text) to authenticated, service_role;

-- the Client viewer access table lists client username logins (rows stay limited by the existing policy)
grant select (username) on neas.client_access_credentials to authenticated;
