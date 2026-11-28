-- Phase 1 of username + PIN sign-in (design section G, approved 2026-10-24).
-- The PIN is the Supabase Auth password (bcrypt, never stored here). This migration adds the
-- username, failed-attempt tracking with lockout, and a server-checked "PIN re-entered recently"
-- rule for sensitive changes (roles, module access, account status, client access, sharing).

alter table neas.profiles add column if not exists username text;
alter table neas.profiles add column if not exists pin_locked_at timestamptz;
alter table neas.profiles add column if not exists reauth_at timestamptz;
do $$ begin
  alter table neas.profiles add constraint profiles_username_format check (username is null or username ~ '^[a-z0-9][a-z0-9.-]{2,31}$');
exception when duplicate_object then null; end $$;
create unique index if not exists profiles_username_unique on neas.profiles (username) where username is not null;

create table if not exists neas.pin_login_attempts (
  id bigint generated always as identity primary key,
  username text not null,
  ip_hash text not null,
  ok boolean not null,
  at timestamptz not null default now()
);
create index if not exists pin_login_attempts_user on neas.pin_login_attempts (username, at desc);
create index if not exists pin_login_attempts_ip on neas.pin_login_attempts (ip_hash, at desc);
alter table neas.pin_login_attempts enable row level security;
revoke all on neas.pin_login_attempts from anon, authenticated;
grant all on neas.pin_login_attempts to service_role;

-- Before a sign-in: is this username (or this network) locked? Returns the account's sign-in
-- address only when it may be tried. Server only.
create or replace function neas.pin_login_begin(p_username text, p_ip_hash text)
returns table (allowed boolean, email text, user_id uuid, error text)
language plpgsql security definer set search_path = neas, extensions as $$
declare
  u text := lower(trim(p_username));
  prof neas.profiles%rowtype;
  generic constant text := 'Username or PIN is not correct, or the account is not active.';
begin
  if (select count(*) from neas.pin_login_attempts a where a.ip_hash = p_ip_hash and not a.ok and a.at > now() - interval '15 minutes') >= 20 then
    return query select false, null::text, null::uuid, 'Too many attempts from this network. Try again in 15 minutes.'::text;
    return;
  end if;
  select * into prof from neas.profiles p where p.username = u;
  -- a 24-hour lock (10 wrong PINs in a day) ends by itself after 24 hours, or earlier when a Super Admin unlocks it;
  -- unknown usernames get the same lock from the same counts, so the answers never reveal which usernames exist
  if (found and prof.pin_locked_at > now() - interval '24 hours')
     or (select count(*) from neas.pin_login_attempts a where a.username = u and not a.ok and a.at > now() - interval '24 hours') >= 10 then
    return query select false, null::text, null::uuid, 'This account is locked for 24 hours after repeated wrong PINs. Ask your NEAS administrator to unlock it sooner.'::text;
    return;
  end if;
  if (select count(*) from neas.pin_login_attempts a where a.username = u and not a.ok and a.at > now() - interval '15 minutes') >= 5 then
    return query select false, null::text, null::uuid, 'Too many wrong PINs. Try again in 15 minutes.'::text;
    return;
  end if;
  return query select true, case when prof.status = 'active' then prof.email end, case when prof.status = 'active' then prof.id end, generic;
end $$;

-- After a sign-in attempt: record it and lock when the limits are reached.
-- Returns 'ok', 'failed', 'locked_15' (5 in 15 min) or 'locked_admin' (10 in 24 h).
create or replace function neas.pin_login_finish(p_username text, p_ip_hash text, p_ok boolean)
returns text language plpgsql security definer set search_path = neas, extensions as $$
declare
  u text := lower(trim(p_username));
  pid uuid;
  f15 int;
  f24 int;
begin
  insert into neas.pin_login_attempts (username, ip_hash, ok) values (u, p_ip_hash, p_ok);
  select id into pid from neas.profiles where username = u;
  if p_ok then
    insert into neas.audit_logs (actor_id, action, target_type, target_id) values (pid, 'auth:pin_login', 'profiles', pid::text);
    return 'ok';
  end if;
  insert into neas.audit_logs (actor_kind, action, target_type, target_id, details)
  values ('system', 'auth:pin_login_failed', 'profiles', pid::text, jsonb_build_object('username_known', pid is not null));
  select count(*) filter (where at > now() - interval '15 minutes'), count(*) into f15, f24
  from neas.pin_login_attempts where username = u and not ok and at > now() - interval '24 hours';
  if f24 >= 10 then
    if pid is not null then
      update neas.profiles set pin_locked_at = now() where id = pid and (pin_locked_at is null or pin_locked_at <= now() - interval '24 hours');
      insert into neas.audit_logs (actor_kind, action, target_type, target_id) values ('system', 'auth:pin_locked', 'profiles', pid::text);
    end if;
    return 'locked_admin';
  end if;
  return case when f15 >= 5 then 'locked_15' else 'failed' end;
end $$;

-- PIN re-entered for a sensitive action (set by the server after it verified the PIN).
create or replace function neas.mark_reauth(p_user uuid)
returns void language sql security definer set search_path = neas, extensions as $$
  update neas.profiles set reauth_at = now() where id = p_user;
$$;

create or replace function neas.recent_reauth()
returns boolean language sql stable security definer set search_path = neas, extensions as $$
  select coalesce((select reauth_at > now() - interval '10 minutes' from neas.profiles where id = auth.uid()), false);
$$;

create or replace function neas.require_reauth() returns void
language plpgsql stable security definer set search_path = neas, extensions as $$
begin
  -- only requests made by a signed-in person (API role "authenticated"); the server's own work,
  -- auth-service triggers and the database owner are not asked for a PIN
  if coalesce(current_setting('role', true), '') = 'authenticated' and auth.uid() is not null and not neas.recent_reauth() then
    raise exception 'Enter your PIN again to confirm this change.' using errcode = 'P0403';
  end if;
end $$;

-- Sensitive changes made by a signed-in person need a recent PIN re-check. Changes made by the
-- server itself (auth.uid() is null) and a person's own sign-up/activation are not affected.
create or replace function neas.guard_sensitive_profile_change() returns trigger
language plpgsql security definer set search_path = neas, extensions as $$
begin
  if auth.uid() is not null and auth.uid() <> new.id
     and (new.global_role is distinct from old.global_role or new.status is distinct from old.status
          or new.allowed_views is distinct from old.allowed_views or new.username is distinct from old.username) then
    perform neas.require_reauth();
  end if;
  return new;
end $$;
drop trigger if exists guard_sensitive_profile_change on neas.profiles;
create trigger guard_sensitive_profile_change before update on neas.profiles for each row execute function neas.guard_sensitive_profile_change();

create or replace function neas.guard_reauth_row() returns trigger
language plpgsql security definer set search_path = neas, extensions as $$
begin
  perform neas.require_reauth();
  return coalesce(new, old);
end $$;
drop trigger if exists guard_reauth_client_creds on neas.client_access_credentials;
create trigger guard_reauth_client_creds before insert or update on neas.client_access_credentials for each row execute function neas.guard_reauth_row();
drop trigger if exists guard_reauth_report_shares on neas.report_shares;
create trigger guard_reauth_report_shares before insert on neas.report_shares for each row execute function neas.guard_reauth_row();
drop trigger if exists guard_reauth_memberships on neas.project_memberships;
create trigger guard_reauth_memberships before insert or update or delete on neas.project_memberships for each row execute function neas.guard_reauth_row();
drop trigger if exists guard_reauth_client_content on neas.approved_client_content;
create trigger guard_reauth_client_content before insert or update on neas.approved_client_content for each row execute function neas.guard_reauth_row();

-- Super Admin: set a person's username; unlock a PIN lockout.
create or replace function neas.admin_set_username(p_user uuid, p_username text)
returns text language plpgsql security definer set search_path = neas, extensions as $$
declare u text := nullif(lower(trim(p_username)), '');
begin
  if not neas.is_super_admin() then raise exception 'Not authorized' using errcode = '42501'; end if;
  if u is not null and u !~ '^[a-z0-9][a-z0-9.-]{2,31}$' then
    raise exception 'Usernames are 3 to 32 lowercase letters, numbers, dots or dashes' using errcode = '22023';
  end if;
  begin
    update neas.profiles set username = u where id = p_user;
  exception when unique_violation then
    raise exception 'That username is already taken' using errcode = '23505';
  end;
  if not found then raise exception 'User not found' using errcode = 'P0002'; end if;
  insert into neas.audit_logs (actor_id, action, target_type, target_id, details)
  values (auth.uid(), 'admin:set_username', 'profiles', p_user::text, jsonb_build_object('username', u));
  return u;
end $$;

create or replace function neas.admin_unlock_pin(p_user uuid)
returns void language plpgsql security definer set search_path = neas, extensions as $$
declare u text;
begin
  if not neas.is_super_admin() then raise exception 'Not authorized' using errcode = '42501'; end if;
  perform neas.require_reauth();
  update neas.profiles set pin_locked_at = null where id = p_user returning username into u;
  -- forget earlier failures so the person gets a fresh set of tries
  delete from neas.pin_login_attempts where username = u and not ok;
  insert into neas.audit_logs (actor_id, action, target_type, target_id) values (auth.uid(), 'admin:unlock_pin', 'profiles', p_user::text);
end $$;

-- permissions: the sign-in helpers are server-only; admin helpers for signed-in Super Admins
revoke execute on function neas.pin_login_begin(text, text) from public, anon, authenticated;
revoke execute on function neas.pin_login_finish(text, text, boolean) from public, anon, authenticated;
revoke execute on function neas.mark_reauth(uuid) from public, anon, authenticated;
grant execute on function neas.pin_login_begin(text, text) to service_role;
grant execute on function neas.pin_login_finish(text, text, boolean) to service_role;
grant execute on function neas.mark_reauth(uuid) to service_role;
revoke execute on function neas.recent_reauth() from public, anon;
revoke execute on function neas.require_reauth() from public, anon;
revoke execute on function neas.admin_set_username(uuid, text) from public, anon;
revoke execute on function neas.admin_unlock_pin(uuid) from public, anon;
grant execute on function neas.recent_reauth() to authenticated, service_role;
grant execute on function neas.require_reauth() to authenticated, service_role;
grant execute on function neas.admin_set_username(uuid, text) to authenticated, service_role;
grant execute on function neas.admin_unlock_pin(uuid) to authenticated, service_role;
revoke execute on function neas.guard_sensitive_profile_change() from public, anon, authenticated;
revoke execute on function neas.guard_reauth_row() from public, anon, authenticated;
