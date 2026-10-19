-- One-time passcodes issued by the administrator.
--   * Employees: a single-use activation code (expires, hashed). The person enters e-mail + code and
--     chooses their own password. No e-mail delivery needed; the admin hands the code over directly.
--   * Clients: a passcode can be one-time (works for one sign-in / one device) or reusable, and the
--     client session can last up to 30 days so the portal also works offline between visits.
-- Additive and idempotent.

-- ---------------------------------------------------------------------------
-- Employees
-- ---------------------------------------------------------------------------
create table if not exists neas.user_setup_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references neas.profiles (id) on delete cascade,
  code_hash text not null,
  created_by uuid references neas.profiles (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists user_setup_codes_user_idx on neas.user_setup_codes (user_id) where used_at is null and revoked_at is null;
alter table neas.user_setup_codes enable row level security;
drop policy if exists setup_codes_admin on neas.user_setup_codes;
create policy setup_codes_admin on neas.user_setup_codes for select to authenticated using (neas.is_super_admin());
grant select on neas.user_setup_codes to authenticated;

create table if not exists neas.setup_code_attempts (
  id bigint generated always as identity primary key,
  email text not null,
  ip_hash text not null,
  success boolean not null,
  at timestamptz not null default now()
);
create index if not exists setup_code_attempts_idx on neas.setup_code_attempts (at desc);
alter table neas.setup_code_attempts enable row level security; -- no policies: service role only

create or replace function neas.random_code_() returns text
language plpgsql volatile set search_path = neas, extensions as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- no 0/O/1/I
  bytes bytea := gen_random_bytes(12);
  code text := '';
  i int;
begin
  for i in 0..11 loop
    code := code || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
    if i in (3, 7) then code := code || '-'; end if;
  end loop;
  return code; -- 12 symbols from 32 ≈ 60 bits
end $$;
revoke all on function neas.random_code_() from public, anon, authenticated;

-- Issues a new code for an approved account; earlier unused codes stop working.
create or replace function neas.admin_issue_setup_code(p_user uuid, p_hours int default 72)
returns table (code text, expires_at timestamptz)
language plpgsql security definer set search_path = neas, extensions as $$
declare c text; exp timestamptz;
begin
  if not neas.is_super_admin() then raise exception 'Not authorized' using errcode = '42501'; end if;
  if not exists (select 1 from neas.profiles where id = p_user and status = 'active') then
    raise exception 'Approve or reactivate the account before issuing a code';
  end if;
  if p_hours is null or p_hours < 1 or p_hours > 720 then raise exception 'Code lifetime must be 1 to 720 hours'; end if;
  update neas.user_setup_codes set revoked_at = now() where user_id = p_user and used_at is null and revoked_at is null;
  c := neas.random_code_();
  exp := now() + make_interval(hours => p_hours);
  insert into neas.user_setup_codes (user_id, code_hash, created_by, expires_at)
    values (p_user, crypt(replace(c, '-', ''), gen_salt('bf', 10)), auth.uid(), exp);
  perform neas.write_audit('account:setup_code_issued', null, 'profiles', p_user::text, jsonb_build_object('expires_at', exp));
  return query select c, exp;
end $$;
grant execute on function neas.admin_issue_setup_code(uuid, int) to authenticated;

-- Redeems a code (server route only). Failures return ok=false so attempts are kept for throttling.
create or replace function neas.redeem_setup_code(p_email text, p_code text, p_ip_hash text)
returns table (ok boolean, error text, user_id uuid)
language plpgsql security definer set search_path = neas, extensions as $$
declare
  prof neas.profiles%rowtype;
  hit neas.user_setup_codes%rowtype;
  fails int;
  generic constant text := 'E-mail or code is not valid, or the code has expired.';
begin
  select count(*) into fails from neas.setup_code_attempts a
   where not a.success and a.at > now() - interval '15 minutes' and (a.ip_hash = p_ip_hash or a.email = lower(trim(p_email)));
  if fails >= 5 then
    return query select false, 'Too many attempts. Try again in 15 minutes.'::text, null::uuid;
    return;
  end if;
  select * into prof from neas.profiles p where lower(p.email) = lower(trim(p_email)) and p.status = 'active';
  if found then
    select c.* into hit from neas.user_setup_codes c
     where c.user_id = prof.id and c.used_at is null and c.revoked_at is null and c.expires_at > now()
       and c.code_hash = crypt(upper(regexp_replace(p_code, '[^A-Za-z0-9]', '', 'g')), c.code_hash)
     limit 1;
  end if;
  if prof.id is null or hit.id is null then
    insert into neas.setup_code_attempts (email, ip_hash, success) values (lower(trim(p_email)), p_ip_hash, false);
    insert into neas.audit_logs (actor_kind, action, target_type, target_id, details)
      values ('system', 'account:setup_code_failed', 'profiles', prof.id::text, '{}'::jsonb);
    return query select false, generic, null::uuid;
    return;
  end if;
  update neas.user_setup_codes set used_at = now() where id = hit.id;
  update neas.profiles set password_set_at = now(), email_verified_at = coalesce(email_verified_at, now()) where id = prof.id;
  insert into neas.setup_code_attempts (email, ip_hash, success) values (lower(trim(p_email)), p_ip_hash, true);
  insert into neas.audit_logs (actor_id, actor_kind, action, target_type, target_id) values (prof.id, 'user', 'account:setup_code_used', 'profiles', prof.id::text);
  return query select true, null::text, prof.id;
end $$;
revoke all on function neas.redeem_setup_code(text, text, text) from public, anon, authenticated;
grant execute on function neas.redeem_setup_code(text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Clients
-- ---------------------------------------------------------------------------
alter table neas.client_access_credentials add column if not exists max_uses int;
alter table neas.client_access_credentials add column if not exists use_count int not null default 0;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'client_creds_max_uses_positive') then
    alter table neas.client_access_credentials add constraint client_creds_max_uses_positive check (max_uses is null or max_uses > 0);
  end if;
  -- client sessions may last up to 30 days (offline use between visits)
  alter table neas.approved_client_content drop constraint if exists approved_client_content_session_hours_check;
  if not exists (select 1 from pg_constraint where conname = 'client_session_hours_range') then
    alter table neas.approved_client_content add constraint client_session_hours_range check (session_hours between 1 and 720);
  end if;
end $$;

drop function if exists neas.admin_create_client_passcode(uuid, text, timestamptz, boolean);
create or replace function neas.admin_create_client_passcode(p_project uuid, p_label text default 'Client access', p_expires_at timestamptz default null, p_revoke_existing boolean default false, p_one_time boolean default false)
returns text language plpgsql security definer set search_path = neas, extensions as $$
declare code text;
begin
  if not neas.is_super_admin() then raise exception 'Not authorized' using errcode = '42501'; end if;
  if not exists (select 1 from neas.projects where id = p_project) then raise exception 'Project not found'; end if;
  if p_expires_at is not null and p_expires_at <= now() then raise exception 'Expiry must be in the future'; end if;
  code := neas.random_code_();
  if p_revoke_existing then
    update neas.client_access_credentials set revoked_at = now() where project_id = p_project and revoked_at is null;
    update neas.client_sessions set revoked_at = now() where project_id = p_project and revoked_at is null;
  end if;
  insert into neas.client_access_credentials (project_id, label, passcode_hash, created_by, expires_at, max_uses)
  values (p_project, coalesce(nullif(trim(p_label), ''), 'Client access'), crypt(replace(code, '-', ''), gen_salt('bf', 10)), auth.uid(), p_expires_at,
          case when p_one_time then 1 end);
  insert into neas.approved_client_content (project_id) values (p_project) on conflict do nothing;
  return code;
end $$;
grant execute on function neas.admin_create_client_passcode(uuid, text, timestamptz, boolean, boolean) to authenticated;

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
