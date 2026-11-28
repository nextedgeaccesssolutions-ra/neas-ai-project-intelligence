-- Clients sign in on the same page as staff, with a username and a 6-digit passcode.
-- A client login is a client-portal credential with a username: it only ever sees the approved
-- client snapshot (never costs or staff data), exactly like the project-code + passcode login.

alter table neas.client_access_credentials add column if not exists username text;
create unique index if not exists client_creds_username_idx on neas.client_access_credentials (username)
  where username is not null and revoked_at is null;

-- staff and client usernames share one namespace, so a username always means one person
create or replace function neas.username_taken(p_username text) returns boolean
language sql stable security definer set search_path = neas, extensions as $$
  select exists (select 1 from neas.profiles where username = lower(btrim(p_username)))
      or exists (select 1 from neas.client_access_credentials where username = lower(btrim(p_username)) and revoked_at is null);
$$;

create or replace function neas.admin_create_client_login(p_project uuid, p_label text, p_username text, p_passcode text, p_days int default null)
returns uuid language plpgsql security definer set search_path = neas, extensions as $$
declare
  u text := lower(btrim(p_username));
  new_id uuid;
begin
  if not neas.is_super_admin() then raise exception 'Only a Super Admin can add client logins' using errcode = '42501'; end if;
  if u !~ '^[a-z0-9][a-z0-9.-]{2,31}$' then raise exception 'Usernames are 3 to 32 lowercase letters, numbers, dots or dashes.' using errcode = '22023'; end if;
  if p_passcode !~ '^\d{6}$' then raise exception 'The passcode must be exactly 6 digits.' using errcode = '22023'; end if;
  if neas.username_taken(u) then raise exception 'That username is already used.' using errcode = '23505'; end if;
  if not exists (select 1 from neas.projects where id = p_project) then raise exception 'Project not found' using errcode = 'P0002'; end if;
  insert into neas.client_access_credentials (project_id, label, passcode_hash, created_by, expires_at, username)
    values (p_project, coalesce(nullif(btrim(p_label), ''), 'Client'), crypt(p_passcode, gen_salt('bf', 10)), auth.uid(),
            case when p_days is null then null else now() + make_interval(days => p_days) end, u)
    returning id into new_id;
  update neas.projects set client_portal_enabled = true where id = p_project;
  insert into neas.audit_logs (actor_id, actor_kind, action, project_id, target_type, target_id, details)
    values (auth.uid(), 'user', 'client:login_created', p_project, 'client_access_credentials', new_id::text, jsonb_build_object('username', u));
  return new_id;
end $$;

-- same throttle as the project-code login (5 wrong in 15 min per username and network), plus 10 in 24 h per username
create or replace function neas.client_login_username(p_username text, p_passcode text, p_ip_hash text, p_user_agent text default null)
returns table (ok boolean, error text, session_token text, project_code text, expires_at timestamptz)
language plpgsql security definer set search_path = neas, extensions as $$
declare
  u text := lower(btrim(p_username));
  key text := 'U:' || lower(btrim(p_username));
  cred neas.client_access_credentials%rowtype;
  proj neas.projects%rowtype;
  token text;
  hours int;
begin
  if (select count(*) from neas.client_login_attempts a where a.project_code = key and a.ip_hash = p_ip_hash and not a.success and a.at > now() - interval '15 minutes') >= 5
     or (select count(*) from neas.client_login_attempts a where a.project_code = key and not a.success and a.at > now() - interval '24 hours') >= 10 then
    return query select false, 'Too many attempts. Try again later.'::text, null::text, null::text, null::timestamptz;
    return;
  end if;
  select c.* into cred from neas.client_access_credentials c
   where c.username = u and c.revoked_at is null and (c.expires_at is null or c.expires_at > now())
     and (c.max_uses is null or c.use_count < c.max_uses)
     and c.passcode_hash = crypt(p_passcode, c.passcode_hash)
     and (c.allowed_ip_hashes is null or p_ip_hash = any (c.allowed_ip_hashes))
   limit 1 for update;
  if found then
    select * into proj from neas.projects pr where pr.id = cred.project_id and pr.status in ('active', 'completed') and pr.client_portal_enabled;
  end if;
  if cred.id is null or proj.id is null then
    insert into neas.client_login_attempts (project_code, ip_hash, success) values (key, p_ip_hash, false);
    return query select false, 'Username or passcode is not correct, or the account is not active.'::text, null::text, null::text, null::timestamptz;
    return;
  end if;
  select coalesce(acc.session_hours, 8) into hours from neas.approved_client_content acc where acc.project_id = proj.id;
  token := encode(gen_random_bytes(32), 'hex');
  insert into neas.client_sessions (credential_id, project_id, token_hash, ip_hash, user_agent, expires_at)
    values (cred.id, proj.id, encode(digest(token, 'sha256'), 'hex'), p_ip_hash, left(p_user_agent, 300), now() + make_interval(hours => coalesce(hours, 8)));
  update neas.client_access_credentials set last_used_at = now(), use_count = use_count + 1 where id = cred.id;
  insert into neas.client_login_attempts (project_code, ip_hash, success) values (key, p_ip_hash, true);
  insert into neas.audit_logs (actor_kind, action, project_id, target_type, target_id, details)
    values ('client', 'client:login', proj.id, 'client_access_credentials', cred.id::text, jsonb_build_object('username', u));
  return query select true, null::text, token, proj.code, now() + make_interval(hours => coalesce(hours, 8));
end $$;

revoke all on function neas.username_taken(text) from public, anon;
revoke all on function neas.username_taken(text) from authenticated;
grant execute on function neas.username_taken(text) to service_role;
revoke all on function neas.admin_create_client_login(uuid, text, text, text, int) from public, anon;
grant execute on function neas.admin_create_client_login(uuid, text, text, text, int) to authenticated, service_role;
revoke all on function neas.client_login_username(text, text, text, text) from public, anon, authenticated;
grant execute on function neas.client_login_username(text, text, text, text) to service_role;

-- a staff username may not reuse a client username
create or replace function neas.admin_set_username(p_user uuid, p_username text)
returns text language plpgsql security definer set search_path = neas, extensions as $$
declare u text := nullif(lower(trim(p_username)), '');
begin
  if not neas.is_super_admin() then raise exception 'Not authorized' using errcode = '42501'; end if;
  if u is not null and u !~ '^[a-z0-9][a-z0-9.-]{2,31}$' then
    raise exception 'Usernames are 3 to 32 lowercase letters, numbers, dots or dashes' using errcode = '22023';
  end if;
  if u is not null and exists (select 1 from neas.client_access_credentials where username = u and revoked_at is null) then
    raise exception 'That username is already taken' using errcode = '23505';
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

-- the project-code login never accepts a username login's passcode
create or replace function neas.client_login(p_code text, p_passcode text, p_ip_hash text, p_user_agent text default null)
returns table (ok boolean, error text, session_token text, project_id uuid, expires_at timestamptz)
language plpgsql security definer set search_path = neas, extensions as $$
declare
  proj neas.projects%rowtype;
  cred neas.client_access_credentials%rowtype;
  recent_failures int;
  token text;
  hours int;
  generic constant text := 'Invalid project code or passcode';
begin
  select count(*) into recent_failures from neas.client_login_attempts a
  where a.project_code = upper(p_code) and a.ip_hash = p_ip_hash and not a.success and a.at > now() - interval '15 minutes';
  if recent_failures >= 5 then
    insert into neas.audit_logs (actor_kind, action, target_type, details)
      values ('client', 'client:login_throttled', 'client_portal', jsonb_build_object('code', upper(p_code)));
    return query select false, 'Too many attempts. Try again in 15 minutes.'::text, null::text, null::uuid, null::timestamptz;
    return;
  end if;

  select * into proj from neas.projects pr where pr.code = upper(p_code) and pr.status in ('active', 'completed') and pr.client_portal_enabled;
  if found then
    select c.* into cred from neas.client_access_credentials c
    where c.project_id = proj.id and c.revoked_at is null and (c.expires_at is null or c.expires_at > now())
      and (c.max_uses is null or c.use_count < c.max_uses)
      and c.username is null  -- username logins (6-digit) only sign in through the username lockout
      and c.passcode_hash = crypt(upper(regexp_replace(p_passcode, '[^A-Za-z0-9]', '', 'g')), c.passcode_hash)
      and (c.allowed_ip_hashes is null or p_ip_hash = any (c.allowed_ip_hashes))
    limit 1
    for update;
  end if;

  if proj.id is null or cred.id is null then
    insert into neas.client_login_attempts (project_code, ip_hash, success) values (upper(p_code), p_ip_hash, false);
    insert into neas.audit_logs (actor_kind, action, project_id, target_type, details)
      values ('client', 'client:login_failed', proj.id, 'client_portal', jsonb_build_object('code', upper(p_code)));
    return query select false, generic, null::text, null::uuid, null::timestamptz;
    return;
  end if;

  select coalesce(acc.session_hours, 8) into hours from neas.approved_client_content acc where acc.project_id = proj.id;
  token := encode(gen_random_bytes(32), 'hex');
  insert into neas.client_sessions (credential_id, project_id, token_hash, ip_hash, user_agent, expires_at)
    values (cred.id, proj.id, encode(digest(token, 'sha256'), 'hex'), p_ip_hash, left(p_user_agent, 300), now() + make_interval(hours => coalesce(hours, 8)));
  update neas.client_access_credentials set last_used_at = now(), use_count = use_count + 1 where id = cred.id;
  insert into neas.client_login_attempts (project_code, ip_hash, success) values (upper(p_code), p_ip_hash, true);
  insert into neas.audit_logs (actor_kind, action, project_id, target_type, target_id, details)
    values ('client', 'client:login', proj.id, 'client_access_credentials', cred.id::text, jsonb_build_object('one_time', cred.max_uses = 1));
  return query select true, null::text, token, proj.id, now() + make_interval(hours => coalesce(hours, 8));
end $$;
revoke all on function neas.client_login(text, text, text, text) from public, anon, authenticated;
grant execute on function neas.client_login(text, text, text, text) to service_role;
