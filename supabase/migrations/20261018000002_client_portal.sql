-- NEAS client viewer portal: passcode-only, read-only, allowlisted content.
-- Passcodes are stored as bcrypt hashes. Login and snapshot functions are callable only
-- with the service role from server routes; browsers never receive Supabase access for clients.

create table if not exists neas.client_access_credentials (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references neas.projects (id) on delete cascade,
  label text not null default 'Client access',
  passcode_hash text not null,
  created_by uuid references neas.profiles (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  allowed_ip_hashes text[]
);
create index if not exists client_creds_project_idx on neas.client_access_credentials (project_id) where revoked_at is null;

create table if not exists neas.client_sessions (
  id uuid primary key default gen_random_uuid(),
  credential_id uuid not null references neas.client_access_credentials (id) on delete cascade,
  project_id uuid not null references neas.projects (id) on delete cascade,
  token_hash text not null unique,
  ip_hash text,
  user_agent text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_seen_at timestamptz
);

create table if not exists neas.client_login_attempts (
  id bigint generated always as identity primary key,
  project_code text not null,
  ip_hash text not null,
  success boolean not null,
  at timestamptz not null default now()
);
create index if not exists client_login_attempts_idx on neas.client_login_attempts (project_code, ip_hash, at desc);

-- What clients may see, per project. Everything is off until an administrator turns it on.
create table if not exists neas.approved_client_content (
  project_id uuid primary key references neas.projects (id) on delete cascade,
  show_overview boolean not null default true,
  show_milestones boolean not null default false,
  show_progress boolean not null default false,
  show_gantt boolean not null default false,
  show_scurve boolean not null default false,
  show_reports boolean not null default false,
  show_photos boolean not null default false,
  show_documents boolean not null default false,
  show_completion boolean not null default false,
  session_hours integer not null default 8 check (session_hours between 1 and 72),
  updated_by uuid references neas.profiles (id),
  updated_at timestamptz not null default now()
);

alter table neas.client_access_credentials enable row level security;
alter table neas.client_sessions enable row level security;
alter table neas.client_login_attempts enable row level security;
alter table neas.approved_client_content enable row level security;

revoke all on neas.client_access_credentials, neas.client_sessions, neas.client_login_attempts, neas.approved_client_content from anon, authenticated;
grant all on neas.client_access_credentials, neas.client_sessions, neas.client_login_attempts, neas.approved_client_content to service_role;

-- Admins can list credentials but never read the hash.
grant select (id, project_id, label, created_by, created_at, expires_at, revoked_at, last_used_at) on neas.client_access_credentials to authenticated;
drop policy if exists client_creds_admin on neas.client_access_credentials;
create policy client_creds_admin on neas.client_access_credentials for select to authenticated using (neas.is_super_admin());

grant select, insert, update on neas.approved_client_content to authenticated;
drop policy if exists client_content_select on neas.approved_client_content;
create policy client_content_select on neas.approved_client_content for select to authenticated
  using (neas.is_super_admin() or neas.is_manager(project_id));
drop policy if exists client_content_write on neas.approved_client_content;
create policy client_content_write on neas.approved_client_content for all to authenticated
  using (neas.is_super_admin()) with check (neas.is_super_admin());

drop trigger if exists audit_client_creds on neas.client_access_credentials;
create trigger audit_client_creds after insert or update or delete on neas.client_access_credentials for each row execute function neas.audit_row();
drop trigger if exists audit_client_content on neas.approved_client_content;
create trigger audit_client_content after insert or update on neas.approved_client_content for each row execute function neas.audit_row();

-- ---------------------------------------------------------------------------
-- Admin: create / rotate / revoke passcodes. The plaintext is returned once and never stored.
-- ---------------------------------------------------------------------------
create or replace function neas.admin_create_client_passcode(p_project uuid, p_label text default 'Client access', p_expires_at timestamptz default null, p_revoke_existing boolean default false)
returns text language plpgsql security definer set search_path = neas, extensions as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- no 0/O/1/I
  bytes bytea := gen_random_bytes(12);
  code text := '';
  i int;
begin
  if not neas.is_super_admin() then raise exception 'Not authorized' using errcode = '42501'; end if;
  if not exists (select 1 from neas.projects where id = p_project) then raise exception 'Project not found'; end if;
  if p_expires_at is not null and p_expires_at <= now() then raise exception 'Expiry must be in the future'; end if;
  for i in 0..11 loop
    code := code || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
    if i in (3, 7) then code := code || '-'; end if;
  end loop;
  if p_revoke_existing then
    update neas.client_access_credentials set revoked_at = now() where project_id = p_project and revoked_at is null;
    update neas.client_sessions set revoked_at = now() where project_id = p_project and revoked_at is null;
  end if;
  insert into neas.client_access_credentials (project_id, label, passcode_hash, created_by, expires_at)
  values (p_project, coalesce(nullif(trim(p_label), ''), 'Client access'), crypt(replace(code, '-', ''), gen_salt('bf', 10)), auth.uid(), p_expires_at);
  insert into neas.approved_client_content (project_id) values (p_project) on conflict do nothing;
  return code; -- 12 characters from a 32-symbol alphabet ≈ 60 bits
end $$;

create or replace function neas.admin_revoke_client_passcode(p_credential uuid)
returns void language plpgsql security definer set search_path = neas, extensions as $$
begin
  if not neas.is_super_admin() then raise exception 'Not authorized' using errcode = '42501'; end if;
  update neas.client_access_credentials set revoked_at = now() where id = p_credential and revoked_at is null;
  update neas.client_sessions set revoked_at = now() where credential_id = p_credential and revoked_at is null;
end $$;

grant execute on function neas.admin_create_client_passcode(uuid, text, timestamptz, boolean), neas.admin_revoke_client_passcode(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Client login / snapshot / logout — service role only (called from server routes)
-- Failures RETURN ok = false instead of raising, so failed attempts and their audit
-- entries are committed (a raised error would roll them back and defeat throttling).
-- ---------------------------------------------------------------------------
drop function if exists neas.client_login(text, text, text, text);
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
      and c.passcode_hash = crypt(upper(regexp_replace(p_passcode, '[^A-Za-z0-9]', '', 'g')), c.passcode_hash)
      and (c.allowed_ip_hashes is null or p_ip_hash = any (c.allowed_ip_hashes))
    limit 1;
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
  update neas.client_access_credentials set last_used_at = now() where id = cred.id;
  insert into neas.client_login_attempts (project_code, ip_hash, success) values (upper(p_code), p_ip_hash, true);
  insert into neas.audit_logs (actor_kind, action, project_id, target_type, target_id)
    values ('client', 'client:login', proj.id, 'client_access_credentials', cred.id::text);
  return query select true, null::text, token, proj.id, now() + make_interval(hours => coalesce(hours, 8));
end $$;

-- Returns only allowlisted, approved content for the session's project. Never costs, BOQ,
-- quotations, staff names or contact details, drafts, or unapproved reports and photos.
create or replace function neas.client_snapshot(p_token text)
returns jsonb language plpgsql security definer set search_path = neas, extensions as $$
declare
  s neas.client_sessions%rowtype;
  p neas.projects%rowtype;
  c neas.approved_client_content%rowtype;
  result jsonb;
begin
  select cs.* into s from neas.client_sessions cs
  join neas.client_access_credentials cr on cr.id = cs.credential_id
  where cs.token_hash = encode(digest(p_token, 'sha256'), 'hex')
    and cs.revoked_at is null and cs.expires_at > now()
    and cr.revoked_at is null and (cr.expires_at is null or cr.expires_at > now());
  if not found then raise exception 'Session expired' using errcode = 'P0401'; end if;

  select * into p from neas.projects where id = s.project_id and client_portal_enabled and status in ('active', 'completed');
  if not found then raise exception 'Client access is closed for this project' using errcode = 'P0401'; end if;
  select * into c from neas.approved_client_content where project_id = p.id;
  update neas.client_sessions set last_seen_at = now() where id = s.id;

  result := jsonb_build_object(
    'project', jsonb_build_object('code', p.code, 'name', p.name, 'status', p.status) ||
      case when c.show_overview then jsonb_build_object('client', p.client_name, 'site', p.site, 'reference_no', p.reference_no, 'start_date', p.start_date, 'end_date', p.end_date) else '{}'::jsonb end,
    'visibility', to_jsonb(c) - 'project_id' - 'updated_by' - 'updated_at' - 'session_hours',
    'session_expires_at', s.expires_at,
    'generated_at', now()
  );
  if c.show_progress or c.show_gantt or c.show_scurve or c.show_milestones or c.show_completion then
    result := result || jsonb_build_object('activities', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'start_date', a.start_date, 'end_date', a.end_date,
        'weight', a.weight, 'is_milestone', a.is_milestone) order by a.start_date, a.sort_order)
      from neas.activities a where a.project_id = p.id and a.deleted_at is null and a.client_visible), '[]'::jsonb));
    -- actual progress comes from approved progress reports only
    result := result || jsonb_build_object('progress', coalesce((
      select jsonb_agg(jsonb_build_object('activity_id', r.activity_id, 'report_date', r.report_date, 'actual_pct', r.actual_pct) order by r.report_date, r.created_at)
      from neas.project_reports r join neas.activities a on a.id = r.activity_id
      where r.project_id = p.id and r.deleted_at is null and r.status = 'approved' and r.actual_pct is not null and a.client_visible), '[]'::jsonb));
  end if;
  if c.show_reports then
    result := result || jsonb_build_object('reports', coalesce((
      select jsonb_agg(jsonb_build_object('report_date', r.report_date, 'report_type', r.report_type, 'activity', a.name, 'actual_pct', r.actual_pct, 'notes', r.notes) order by r.report_date desc)
      from neas.project_reports r left join neas.activities a on a.id = r.activity_id
      where r.project_id = p.id and r.deleted_at is null and r.status = 'approved' and r.client_visible), '[]'::jsonb));
  end if;
  if c.show_photos or c.show_documents then
    result := result || jsonb_build_object('files', coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'kind', f.kind, 'caption', f.caption, 'storage_path', f.storage_path, 'mime_type', f.mime_type, 'created_at', f.created_at) order by f.created_at desc)
      from neas.report_attachments f
      left join neas.project_reports r on r.id = f.report_id
      where f.project_id = p.id and f.deleted_at is null and f.client_visible
        and (f.report_id is null or r.status = 'approved')
        and ((c.show_photos and f.kind <> 'document') or (c.show_documents and f.kind = 'document'))), '[]'::jsonb));
  end if;
  return result;
end $$;

create or replace function neas.client_logout(p_token text) returns void
language sql security definer set search_path = neas, extensions as $$
  update neas.client_sessions set revoked_at = now() where token_hash = encode(digest(p_token, 'sha256'), 'hex') and revoked_at is null;
$$;

revoke execute on function neas.client_login(text, text, text, text), neas.client_snapshot(text), neas.client_logout(text) from public, anon, authenticated;
grant execute on function neas.client_login(text, text, text, text), neas.client_snapshot(text), neas.client_logout(text) to service_role;
