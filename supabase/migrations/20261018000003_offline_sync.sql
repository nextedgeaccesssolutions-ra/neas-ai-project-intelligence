-- NEAS offline synchronisation: idempotent operation ledger + versioned apply function.
-- apply_operation runs as the caller (SECURITY INVOKER), so every write still passes RLS.

create table if not exists neas.sync_operations (
  op_id uuid primary key,
  user_id uuid not null default auth.uid() references neas.profiles (id) on delete cascade,
  project_id uuid not null,
  entity text not null,
  record_id uuid not null,
  op text not null check (op in ('upsert', 'delete')),
  base_version integer,
  status text not null check (status in ('applied', 'conflict', 'rejected')),
  result jsonb not null,
  client_created_at timestamptz,
  received_at timestamptz not null default now()
);
create index if not exists sync_operations_user_idx on neas.sync_operations (user_id, received_at desc);
create index if not exists sync_operations_status_idx on neas.sync_operations (status, received_at desc) where status <> 'applied';

alter table neas.sync_operations enable row level security;
revoke all on neas.sync_operations from anon, authenticated;
grant select, insert on neas.sync_operations to authenticated;
grant all on neas.sync_operations to service_role;
drop policy if exists sync_ops_select on neas.sync_operations;
create policy sync_ops_select on neas.sync_operations for select to authenticated
  using (user_id = auth.uid() or neas.is_super_admin());
drop policy if exists sync_ops_insert on neas.sync_operations;
create policy sync_ops_insert on neas.sync_operations for insert to authenticated
  with check (user_id = auth.uid() and neas.is_active_user());

-- Google Sheets / Apps Script integration log (server writes with the service role).
create table if not exists neas.integration_sync_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  target text not null default 'google_sheets',
  status text not null check (status in ('ok', 'error', 'skipped')),
  rows_written integer not null default 0,
  idempotency_key text,
  error text
);
alter table neas.integration_sync_log enable row level security;
revoke all on neas.integration_sync_log from anon, authenticated;
grant select on neas.integration_sync_log to authenticated;
grant all on neas.integration_sync_log to service_role;
grant usage, select on all sequences in schema neas to service_role;
drop policy if exists integration_log_admin on neas.integration_sync_log;
create policy integration_log_admin on neas.integration_sync_log for select to authenticated using (neas.is_super_admin());

-- ---------------------------------------------------------------------------
-- apply_operation(op) → {status: applied|conflict|rejected, record?, server_record?, error?, duplicate?}
--   op = {op_id, entity, op: upsert|delete, record_id, project_id, base_version, payload, client_created_at}
-- • Same op_id twice → the stored result is returned (no duplicate rows).
-- • Update/delete with a stale base_version → conflict, with the server's current row.
-- • RLS or validation refusal → rejected (kept by the client for review, never dropped).
-- ---------------------------------------------------------------------------
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
        if cur is null then
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

-- Pull: everything the caller may see for one project changed since a timestamp.
create or replace function neas.pull_changes(p_project uuid, p_since timestamptz default '-infinity')
returns jsonb language sql stable security invoker set search_path = neas, extensions as $$
  select jsonb_build_object(
    'project', (select to_jsonb(p) from neas.projects p where p.id = p_project),
    'activities', coalesce((select jsonb_agg(to_jsonb(a)) from neas.activities a where a.project_id = p_project and a.updated_at > p_since), '[]'::jsonb),
    'reports', coalesce((select jsonb_agg(to_jsonb(r)) from neas.project_reports r where r.project_id = p_project and r.updated_at > p_since), '[]'::jsonb),
    'attachments', coalesce((select jsonb_agg(to_jsonb(f)) from neas.report_attachments f where f.project_id = p_project and f.updated_at > p_since), '[]'::jsonb),
    'boq_lines', coalesce((select jsonb_agg(to_jsonb(b)) from neas.boq_lines b where b.project_id = p_project and b.updated_at > p_since), '[]'::jsonb),
    'cost_settings', (select to_jsonb(c) from neas.cost_settings c where c.project_id = p_project),
    'quotation', (select to_jsonb(q) from neas.quotations q where q.project_id = p_project),
    'server_time', now()
  );
$$;
revoke execute on function neas.pull_changes(uuid, timestamptz) from public, anon;
grant execute on function neas.pull_changes(uuid, timestamptz) to authenticated;
