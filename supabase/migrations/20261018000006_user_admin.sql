-- User administration: session revocation, password-setup tracking, approval/role history.
-- Additive and idempotent; only touches the neas schema (plus deleting a user's own auth sessions
-- when an administrator revokes them).

alter table neas.profiles add column if not exists sessions_revoked_at timestamptz;

-- A token issued before the user's sessions were revoked no longer counts, even before it expires.
-- Supabase puts the issue time in the JWT "iat" claim.
create or replace function neas.token_is_current(p_revoked timestamptz) returns boolean
language sql stable set search_path = neas, extensions as $$
  select p_revoked is null
      or coalesce(nullif(auth.jwt() ->> 'iat', '')::bigint, 0) > floor(extract(epoch from p_revoked))::bigint;
$$;

create or replace function neas.is_active_user() returns boolean
language sql stable security definer set search_path = neas, extensions as $$
  select exists (
    select 1 from neas.profiles p
    where p.id = auth.uid() and p.status = 'active' and p.email_verified_at is not null
      and neas.token_is_current(p.sessions_revoked_at)
  );
$$;

create or replace function neas.is_super_admin() returns boolean
language sql stable security definer set search_path = neas, extensions as $$
  select exists (
    select 1 from neas.profiles p
    where p.id = auth.uid() and p.status = 'active' and p.email_verified_at is not null
      and p.global_role = 'super_admin' and neas.token_is_current(p.sessions_revoked_at)
  );
$$;

-- Ends every session of a user: refresh tokens are deleted (no new access tokens) and access
-- tokens already issued stop working at the database immediately (iat check above).
create or replace function neas.revoke_user_sessions_(p_user uuid) returns void
language plpgsql security definer set search_path = neas, extensions as $$
begin
  update neas.profiles set sessions_revoked_at = now() where id = p_user;
  if to_regclass('auth.sessions') is not null then
    execute 'delete from auth.sessions where user_id = $1' using p_user;
  end if;
end $$;
revoke all on function neas.revoke_user_sessions_(uuid) from public, anon, authenticated;

create or replace function neas.admin_revoke_sessions(p_user uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = neas, extensions as $$
begin
  if not neas.is_super_admin() then raise exception 'Not authorized' using errcode = '42501'; end if;
  if not exists (select 1 from neas.profiles where id = p_user) then raise exception 'User not found'; end if;
  perform neas.revoke_user_sessions_(p_user);
  perform neas.write_audit('account:sessions_revoked', null, 'profiles', p_user::text,
    jsonb_build_object('reason', left(coalesce(p_reason, ''), 200)));
end $$;

-- Suspending or rejecting an account also ends its sessions.
create or replace function neas.admin_set_user_status(p_user uuid, p_status neas.account_status, p_reason text default null)
returns void language plpgsql security definer set search_path = neas, extensions as $$
begin
  if not neas.is_super_admin() then raise exception 'Not authorized' using errcode = '42501'; end if;
  if p_user = auth.uid() and p_status <> 'active' then raise exception 'You cannot suspend your own account'; end if;
  if p_status = 'pending' then raise exception 'Use registration review for pending accounts'; end if;
  update neas.profiles set status = p_status, status_reason = p_reason where id = p_user;
  if not found then raise exception 'User not found'; end if;
  if p_status in ('suspended', 'rejected') then perform neas.revoke_user_sessions_(p_user); end if;
end $$;

-- Role changes within limits: never your own, and never the last active Super Admin.
create or replace function neas.admin_set_global_role(p_user uuid, p_role neas.global_role)
returns void language plpgsql security definer set search_path = neas, extensions as $$
begin
  if not neas.is_super_admin() then raise exception 'Not authorized' using errcode = '42501'; end if;
  if p_user = auth.uid() and p_role <> 'super_admin' then raise exception 'You cannot remove your own Super Admin role'; end if;
  if p_role <> 'super_admin' and (select count(*) from neas.profiles where global_role = 'super_admin' and status = 'active' and id <> p_user) = 0 then
    raise exception 'At least one active Super Admin must remain';
  end if;
  update neas.profiles set global_role = p_role where id = p_user;
  if not found then raise exception 'User not found'; end if;
end $$;

-- Called by the user right after choosing a password (first setup or reset).
create or replace function neas.mark_password_set() returns void
language plpgsql security definer set search_path = neas, extensions as $$
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  update neas.profiles set password_set_at = now() where id = auth.uid();
  perform neas.write_audit('account:password_set', null, 'profiles', auth.uid()::text, '{}'::jsonb);
end $$;

grant execute on function neas.token_is_current(timestamptz) to authenticated;
grant execute on function neas.admin_revoke_sessions(uuid, text), neas.mark_password_set() to authenticated;
grant execute on function neas.admin_set_user_status(uuid, neas.account_status, text), neas.admin_set_global_role(uuid, neas.global_role) to authenticated;
