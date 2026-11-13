-- Report sharing (secure links, QR codes, e-mail) and administrator resolution of offline sync problems.

-- ---------------------------------------------------------------------------
-- 1. Offline sync: a delete of a record that is already deleted is applied, not a conflict.
--    (All eight problems seen on 2026-10-23 were deletes of photos that were already deleted.)
create or replace function neas.apply_operation(p_op jsonb)
returns jsonb language plpgsql security invoker set search_path = neas, extensions as $$
declare
  v_op_id uuid := (p_op ->> 'op_id')::uuid;
  v_entity text := p_op ->> 'entity';
  v_kind text := p_op ->> 'op';
  v_rec uuid := (p_op ->> 'record_id')::uuid;
  v_proj uuid := (p_op ->> 'project_id')::uuid;
  v_base integer := nullif(p_op ->> 'base_version', '')::integer;
  v_payload jsonb := coalesce(p_op -> 'payload', '{}'::jsonb);
  prior neas.sync_operations%rowtype;
  cur jsonb;
  cols text;
  n integer;
  res jsonb;
  st text;
  protected constant text[] := array['id', 'project_id', 'version', 'created_at', 'updated_at', 'updated_by', 'submitted_by', 'uploaded_by', 'deleted_at'];
begin
  if v_op_id is null or v_rec is null or v_proj is null then
    return jsonb_build_object('status', 'rejected', 'error', 'op_id, record_id and project_id are required');
  end if;
  if not neas.is_active_user() then
    return jsonb_build_object('status', 'rejected', 'error', 'Your account is not active. Pending changes were kept for review.');
  end if;
  if v_entity not in ('activities', 'project_reports', 'report_attachments', 'boq_lines', 'cost_settings', 'quotations') then
    return jsonb_build_object('status', 'rejected', 'error', 'Unsupported record type');
  end if;
  if v_kind not in ('upsert', 'delete') then
    return jsonb_build_object('status', 'rejected', 'error', 'Unsupported operation');
  end if;

  select * into prior from neas.sync_operations where op_id = v_op_id;
  if found then
    return prior.result || jsonb_build_object('duplicate', true);
  end if;

  execute format('select to_jsonb(t) from neas.%I t where t.id = $1', v_entity) into cur using v_rec;
  if cur is not null and (cur ->> 'project_id')::uuid <> v_proj then
    res := jsonb_build_object('status', 'rejected', 'error', 'Record belongs to another project');
  else
    select string_agg(quote_ident(k), ', ') into cols
    from jsonb_object_keys(v_payload) k
    where k <> all (protected)
      and exists (select 1 from information_schema.columns c where c.table_schema = 'neas' and c.table_name = v_entity and c.column_name = k);

    begin
      if v_kind = 'delete' then
        -- deleting something that is already gone (or soft-deleted) is the outcome the person wanted
        if cur is null or cur ->> 'deleted_at' is not null then
          res := jsonb_build_object('status', 'applied', 'record', null);
        elsif v_base is null or (cur ->> 'version')::integer <> v_base then
          res := jsonb_build_object('status', 'conflict', 'server_record', cur);
        else
          execute format('update neas.%I t set deleted_at = now() where t.id = $1 and t.version = $2', v_entity) using v_rec, v_base;
          get diagnostics n = row_count;
          res := case when n = 1 then jsonb_build_object('status', 'applied') else jsonb_build_object('status', 'rejected', 'error', 'Not allowed to delete this record') end;
        end if;
      elsif cur is null then
        execute format(
          'insert into neas.%1$I (id, project_id%2$s) select $1, $2%3$s from jsonb_populate_record(null::neas.%1$I, $3) r',
          v_entity,
          case when cols is null then '' else ', ' || cols end,
          case when cols is null then '' else ', ' || (select string_agg('r.' || x, ', ') from unnest(string_to_array(cols, ', ')) x) end
        ) using v_rec, v_proj, v_payload;
        res := jsonb_build_object('status', 'applied');
      elsif v_base is null or (cur ->> 'version')::integer <> v_base then
        res := jsonb_build_object('status', 'conflict', 'server_record', cur);
      elsif cols is null then
        res := jsonb_build_object('status', 'applied');
      else
        execute format(
          'update neas.%1$I t set (%2$s) = (select %3$s from jsonb_populate_record(null::neas.%1$I, $1) r) where t.id = $2 and t.version = $3',
          v_entity, cols, (select string_agg('r.' || x, ', ') from unnest(string_to_array(cols, ', ')) x)
        ) using v_payload, v_rec, v_base;
        get diagnostics n = row_count;
        res := case when n = 1 then jsonb_build_object('status', 'applied') else jsonb_build_object('status', 'rejected', 'error', 'Not allowed to change this record') end;
      end if;
    exception when others then
      res := jsonb_build_object('status', 'rejected', 'error', sqlerrm, 'code', sqlstate);
    end;
  end if;

  if res ->> 'status' = 'applied' then
    execute format('select to_jsonb(t) from neas.%I t where t.id = $1', v_entity) into cur using v_rec;
    res := res || jsonb_build_object('record', cur);
  end if;
  st := res ->> 'status';
  insert into neas.sync_operations (op_id, project_id, entity, record_id, op, base_version, status, result, client_created_at)
  values (v_op_id, v_proj, v_entity, v_rec, v_kind, v_base, st, res, nullif(p_op ->> 'client_created_at', '')::timestamptz);
  return res;
end $$;

revoke execute on function neas.apply_operation(jsonb) from public, anon;
grant execute on function neas.apply_operation(jsonb) to authenticated;

-- 2. Super Admin resolution of conflicts and refused changes (the device copy is never touched).
alter table neas.sync_operations add column if not exists resolved_at timestamptz;
alter table neas.sync_operations add column if not exists resolved_by uuid references neas.profiles (id);
alter table neas.sync_operations add column if not exists resolution text;
do $$ begin
  alter table neas.sync_operations add constraint sync_operations_resolution_check
    check (resolution is null or resolution in ('dismissed', 'already_applied', 'applied_by_admin'));
exception when duplicate_object then null; end $$;

create or replace function neas.resolve_sync_operation(p_op uuid, p_action text, p_note text default '')
returns text language plpgsql security definer set search_path = neas, extensions as $$
declare
  o neas.sync_operations%rowtype;
  gone boolean;
  outcome text;
begin
  if not neas.is_super_admin() then raise exception 'Super Admin only' using errcode = '42501'; end if;
  if p_action not in ('dismiss', 'apply_delete') then raise exception 'Unknown action' using errcode = '22023'; end if;
  select * into o from neas.sync_operations where op_id = p_op for update;
  if not found then raise exception 'Sync problem not found' using errcode = 'P0002'; end if;
  if o.status = 'applied' or o.resolved_at is not null then raise exception 'Already resolved' using errcode = '22023'; end if;
  if o.entity not in ('activities', 'project_reports', 'report_attachments', 'boq_lines', 'quotations') then
    raise exception 'Unsupported record type' using errcode = '22023';
  end if;
  execute format('select not exists (select 1 from neas.%I t where t.id = $1 and t.deleted_at is null)', o.entity) into gone using o.record_id;

  if p_action = 'apply_delete' then
    if o.op <> 'delete' then raise exception 'Only a refused or conflicting delete can be applied here; edits are resolved on the device' using errcode = '22023'; end if;
    if gone then
      outcome := 'already_applied';
    else
      execute format('update neas.%I t set deleted_at = now() where t.id = $1 and t.project_id = $2 and t.deleted_at is null', o.entity) using o.record_id, o.project_id;
      outcome := 'applied_by_admin';
    end if;
  else
    outcome := case when o.op = 'delete' and gone then 'already_applied' else 'dismissed' end;
  end if;

  update neas.sync_operations set resolved_at = now(), resolved_by = auth.uid(), resolution = outcome where op_id = p_op;
  insert into neas.audit_logs (actor_id, action, project_id, target_type, target_id, details)
  values (auth.uid(), 'sync:resolved', o.project_id, o.entity, o.record_id::text,
    jsonb_build_object('op_id', o.op_id, 'op', o.op, 'status', o.status, 'outcome', outcome, 'note', left(coalesce(p_note, ''), 300)));
  return outcome;
end $$;
revoke execute on function neas.resolve_sync_operation(uuid, text, text) from public, anon;
grant execute on function neas.resolve_sync_operation(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Approved project view: the one definition of what a client may see (portal and shared links).
create or replace function neas.approved_project_view(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = neas, extensions as $$
declare
  p neas.projects%rowtype;
  c neas.approved_client_content%rowtype;
  result jsonb;
begin
  select * into p from neas.projects where id = p_project;
  if not found then return null; end if;
  select * into c from neas.approved_client_content where project_id = p.id;
  result := jsonb_build_object(
    'project', jsonb_build_object('code', p.code, 'name', p.name, 'status', p.status) ||
      case when c.show_overview then jsonb_build_object('client', p.client_name, 'site', p.site, 'reference_no', p.reference_no, 'start_date', p.start_date, 'end_date', p.end_date) else '{}'::jsonb end,
    'visibility', to_jsonb(c) - 'project_id' - 'updated_by' - 'updated_at' - 'session_hours',
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
      select jsonb_agg(jsonb_build_object('id', f.id, 'kind', f.kind, 'caption', f.caption, 'storage_path', f.storage_path, 'mime_type', f.mime_type, 'created_at', f.created_at,
          'captured_at', f.captured_at, 'photo_ref', f.photo_ref, 'work_area', f.work_area, 'pair_id', f.pair_id,
          'is_cover', f.is_cover, 'cover_category', f.cover_category, 'cover_order', f.cover_order, 'cover_primary', f.cover_primary,
          'activity', (select a.name from neas.activities a where a.id = f.activity_id and a.project_id = p.id and a.deleted_at is null and a.client_visible)) ||
        -- recorded location only when the project allows clients to see photo locations
        case when c.show_photo_locations then jsonb_build_object('gps_lat', f.gps_lat, 'gps_lng', f.gps_lng, 'gps_accuracy_m', f.gps_accuracy_m,
          'gps_captured_at', f.gps_captured_at, 'gps_status', f.gps_status, 'gps_source', f.gps_source, 'location_detail', f.location_detail) else '{}'::jsonb end
        order by coalesce(f.captured_at, f.created_at) desc)
      from neas.report_attachments f
      left join neas.project_reports r on r.id = f.report_id
      where f.project_id = p.id and f.deleted_at is null and f.client_visible
        and (f.report_id is null or r.status = 'approved')
        and ((c.show_photos and f.kind <> 'document') or (c.show_documents and f.kind = 'document'))), '[]'::jsonb));
  end if;
  return result;
end $$;
-- internal helper: only the definer functions below (and the service role) call it
revoke execute on function neas.approved_project_view(uuid) from public, anon, authenticated;
grant execute on function neas.approved_project_view(uuid) to service_role;

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

  select * into p from neas.projects where id = s.project_id and client_portal_enabled and status in ('active', 'completed');
  if not found then raise exception 'Client access is closed for this project' using errcode = 'P0401'; end if;
  update neas.client_sessions set last_seen_at = now() where id = s.id;
  return neas.approved_project_view(p.id) || jsonb_build_object('session_expires_at', s.expires_at);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Shared links. The raw token is returned once at creation and never stored (SHA-256 only).
create table if not exists neas.report_shares (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references neas.projects (id) on delete cascade,
  scope text not null default 'approved_project_view' check (scope in ('approved_project_view')),
  method text not null check (method in ('link', 'qr', 'email')),
  recipient_email text check (recipient_email is null or (length(recipient_email) <= 254 and recipient_email ~* '^[^@\s<>",;]+@[^@\s<>",;]+\.[a-z]{2,}$')),
  label text not null default '' check (length(label) <= 120),
  token_hash text not null unique,
  request_key text check (request_key is null or length(request_key) between 8 and 80),
  created_by uuid not null default auth.uid() references neas.profiles (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references neas.profiles (id),
  last_opened_at timestamptz,
  open_count integer not null default 0,
  check (expires_at > created_at and expires_at <= created_at + interval '90 days 1 minute'),
  check ((method = 'email') = (recipient_email is not null))
);
create index if not exists report_shares_project on neas.report_shares (project_id, created_at desc);
create unique index if not exists report_shares_request on neas.report_shares (created_by, request_key) where request_key is not null;

create table if not exists neas.report_share_events (
  id bigint generated always as identity primary key,
  share_id uuid not null references neas.report_shares (id) on delete cascade,
  project_id uuid not null references neas.projects (id) on delete cascade,
  at timestamptz not null default now(),
  actor_id uuid,
  event text not null check (event in ('created', 'revoked', 'opened', 'email_sent', 'email_failed')),
  detail jsonb not null default '{}'::jsonb
);
create index if not exists report_share_events_project on neas.report_share_events (project_id, at desc);

alter table neas.report_shares enable row level security;
alter table neas.report_share_events enable row level security;
revoke all on neas.report_shares, neas.report_share_events from anon, authenticated;
grant select on neas.report_shares, neas.report_share_events to authenticated;
grant all on neas.report_shares, neas.report_share_events to service_role;
drop policy if exists report_shares_select on neas.report_shares;
create policy report_shares_select on neas.report_shares for select to authenticated
  using (neas.is_super_admin() or neas.is_manager(project_id));
drop policy if exists report_share_events_select on neas.report_share_events;
create policy report_share_events_select on neas.report_share_events for select to authenticated
  using (neas.is_super_admin() or neas.is_manager(project_id));
drop trigger if exists audit_report_shares on neas.report_shares;
create trigger audit_report_shares after insert or update or delete on neas.report_shares for each row execute function neas.audit_row();

create or replace function neas.create_report_share(p_project uuid, p_method text, p_days integer default 7,
  p_recipient text default null, p_label text default '', p_request_key text default null)
returns jsonb language plpgsql security definer set search_path = neas, extensions as $$
declare
  tok text := rtrim(translate(encode(gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  sid uuid;
  exp timestamptz;
begin
  if not (neas.is_super_admin() or neas.is_manager(p_project)) then
    raise exception 'Only a Super Admin or the project manager can share this project' using errcode = '42501';
  end if;
  if not exists (select 1 from neas.projects where id = p_project and status in ('active', 'completed') and client_portal_enabled) then
    raise exception 'Turn on client access for this project (Control panel → Client viewer access) before sharing it' using errcode = '22023';
  end if;
  if p_method not in ('link', 'qr', 'email') then raise exception 'Unknown share method' using errcode = '22023'; end if;
  if p_days is null or p_days < 1 or p_days > 90 then raise exception 'Links last 1 to 90 days' using errcode = '22023'; end if;
  if p_method = 'email' and (select count(*) from neas.report_shares where created_by = auth.uid() and method = 'email' and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'E-mail limit reached (20 per hour). Try again later.' using errcode = '54000';
  end if;
  exp := now() + make_interval(days => p_days);
  begin
    insert into neas.report_shares (project_id, method, recipient_email, label, token_hash, request_key, created_by, expires_at)
    values (p_project, p_method, case when p_method = 'email' then lower(trim(p_recipient)) end, left(coalesce(p_label, ''), 120),
      encode(digest(tok, 'sha256'), 'hex'), p_request_key, auth.uid(), exp)
    returning id into sid;
  exception when unique_violation then
    raise exception 'This share was already created' using errcode = '23505';
  end;
  insert into neas.report_share_events (share_id, project_id, actor_id, event, detail)
  values (sid, p_project, auth.uid(), 'created', jsonb_build_object('method', p_method, 'days', p_days));
  return jsonb_build_object('id', sid, 'token', tok, 'expires_at', exp);
end $$;
revoke execute on function neas.create_report_share(uuid, text, integer, text, text, text) from public, anon;
grant execute on function neas.create_report_share(uuid, text, integer, text, text, text) to authenticated;

create or replace function neas.revoke_report_share(p_share uuid)
returns void language plpgsql security definer set search_path = neas, extensions as $$
declare r neas.report_shares%rowtype;
begin
  select * into r from neas.report_shares where id = p_share for update;
  if not found or not (neas.is_super_admin() or neas.is_manager(r.project_id)) then
    raise exception 'Share not found' using errcode = '42501';
  end if;
  if r.revoked_at is not null then return; end if;
  update neas.report_shares set revoked_at = now(), revoked_by = auth.uid() where id = p_share;
  insert into neas.report_share_events (share_id, project_id, actor_id, event) values (p_share, r.project_id, auth.uid(), 'revoked');
end $$;
revoke execute on function neas.revoke_report_share(uuid) from public, anon;
grant execute on function neas.revoke_report_share(uuid) to authenticated;

-- Opening a shared link: server only (service role). Every open is checked here, so revocation
-- and expiry take effect immediately for links and QR codes alike.
create or replace function neas.share_snapshot(p_token text)
returns jsonb language plpgsql security definer set search_path = neas, extensions as $$
declare r neas.report_shares%rowtype;
begin
  select * into r from neas.report_shares where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');
  if not found then raise exception 'This link is not valid' using errcode = 'P0401'; end if;
  if r.revoked_at is not null then raise exception 'This link was withdrawn by NEAS' using errcode = 'P0401'; end if;
  if r.expires_at <= now() then raise exception 'This link has expired' using errcode = 'P0401'; end if;
  -- turning client access off also closes every shared link
  if not exists (select 1 from neas.projects where id = r.project_id and status in ('active', 'completed') and client_portal_enabled) then
    raise exception 'This project is no longer shared' using errcode = 'P0401';
  end if;
  update neas.report_shares set open_count = open_count + 1, last_opened_at = now() where id = r.id;
  -- one "opened" entry per link per 10 minutes keeps the history readable
  if not exists (select 1 from neas.report_share_events where share_id = r.id and event = 'opened' and at > now() - interval '10 minutes') then
    insert into neas.report_share_events (share_id, project_id, event) values (r.id, r.project_id, 'opened');
  end if;
  return neas.approved_project_view(r.project_id) || jsonb_build_object('share_expires_at', r.expires_at, 'share_label', r.label);
end $$;
revoke execute on function neas.share_snapshot(text) from public, anon, authenticated;
grant execute on function neas.share_snapshot(text) to service_role;
