-- Client sign-in works for Draft projects too, once the administrator has turned client viewing on
-- (the switch, not the project status, decides). "Revoke existing passcodes" now revokes only the
-- shared project passcodes, never the clients' own username logins.

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

  select * into proj from neas.projects pr where pr.code = upper(p_code) and pr.status in ('draft', 'active', 'completed') and pr.client_portal_enabled;
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
    select * into proj from neas.projects pr where pr.id = cred.project_id and pr.status in ('draft', 'active', 'completed') and pr.client_portal_enabled;
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

create or replace function neas.client_session_for(p_token text)
returns neas.client_sessions language plpgsql security definer set search_path = neas, extensions as $$
declare s neas.client_sessions%rowtype;
begin
  select cs.* into s from neas.client_sessions cs
  join neas.client_access_credentials cr on cr.id = cs.credential_id
  join neas.projects p on p.id = cs.project_id
  where cs.token_hash = encode(digest(p_token, 'sha256'), 'hex')
    and cs.revoked_at is null and cs.expires_at > now()
    and cr.revoked_at is null and (cr.expires_at is null or cr.expires_at > now())
    and p.client_portal_enabled and p.status in ('draft', 'active', 'completed');
  if not found then raise exception 'Session expired' using errcode = 'P0401'; end if;
  return s;
end $$;

create or replace function neas.client_snapshot(p_token text)
returns jsonb language plpgsql security definer set search_path = neas, extensions as $$
declare
  s neas.client_sessions%rowtype;
  p neas.projects%rowtype;
begin
  select cs.* into s from neas.client_sessions cs
  join neas.client_access_credentials cr on cr.id = cs.credential_id
  where cs.token_hash = encode(digest(p_token, 'sha256'), 'hex')
    and cs.revoked_at is null and cs.expires_at > now()
    and cr.revoked_at is null and (cr.expires_at is null or cr.expires_at > now());
  if not found then raise exception 'Session expired' using errcode = 'P0401'; end if;

  select * into p from neas.projects where id = s.project_id and client_portal_enabled and status in ('draft', 'active', 'completed');
  if not found then raise exception 'Client access is closed for this project' using errcode = 'P0401'; end if;
  update neas.client_sessions set last_seen_at = now() where id = s.id;
  return neas.approved_project_view(p.id) || jsonb_build_object('session_expires_at', s.expires_at);
end $$;

create or replace function neas.admin_create_client_passcode(p_project uuid, p_label text default 'Client access', p_expires_at timestamptz default null, p_revoke_existing boolean default false, p_one_time boolean default false)
returns text language plpgsql security definer set search_path = neas, extensions as $$
declare code text;
begin
  if not neas.is_super_admin() then raise exception 'Not authorized' using errcode = '42501'; end if;
  if not exists (select 1 from neas.projects where id = p_project) then raise exception 'Project not found'; end if;
  if p_expires_at is not null and p_expires_at <= now() then raise exception 'Expiry must be in the future'; end if;
  code := neas.random_code_();
  if p_revoke_existing then
    update neas.client_access_credentials set revoked_at = now() where project_id = p_project and revoked_at is null and username is null;
    update neas.client_sessions set revoked_at = now() where project_id = p_project and revoked_at is null
      and credential_id in (select id from neas.client_access_credentials where project_id = p_project and username is null);
  end if;
  insert into neas.client_access_credentials (project_id, label, passcode_hash, created_by, expires_at, max_uses)
  values (p_project, coalesce(nullif(trim(p_label), ''), 'Client access'), crypt(replace(code, '-', ''), gen_salt('bf', 10)), auth.uid(), p_expires_at,
          case when p_one_time then 1 end);
  insert into neas.approved_client_content (project_id) values (p_project) on conflict do nothing;
  return code;
end $$;
