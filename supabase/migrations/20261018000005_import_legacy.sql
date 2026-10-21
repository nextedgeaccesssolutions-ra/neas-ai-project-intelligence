-- Copies records from the existing NEAS app (public.* tables in Supabase project
-- smlxekhbaefbvdbfxpew) into the neas schema, so the upgraded platform opens with the
-- same users, projects, schedule, reports and BOQ.
--
-- Safety:
--   * READ-ONLY on public.*: nothing in the existing app is changed or deleted.
--   * Idempotent: every insert is ON CONFLICT DO NOTHING with stable ids, so it can be
--     re-run to pick up records added in the old app since the last run.
--   * Not run automatically. A database owner runs it deliberately:
--         select neas.import_legacy_public();
--   * Callable only by the database owner / service_role, never by browser sessions.
-- Not copied: evidence photos (they stay in the private neas-project-evidence bucket).

create or replace function neas.import_legacy_public()
returns jsonb
language plpgsql
security definer
set search_path = neas, public, extensions
as $$
declare
  c_profiles int := 0; c_projects int := 0; c_members int := 0; c_acts int := 0;
  c_reports int := 0; c_boq int := 0; c_quotes int := 0; c_settings int := 0;
  has_roles boolean := to_regclass('public.user_roles') is not null;
begin
  if to_regclass('public.projects') is null then
    return jsonb_build_object('ok', false, 'error', 'No legacy public.projects table in this database');
  end if;

  -- 1. Accounts. Legacy admin -> Super Admin; legacy working roles -> active staff;
  --    legacy 'viewer' (the default for unreviewed sign-ups) -> pending approval.
  if has_roles then
    execute $q$
      insert into neas.profiles (id, email, full_name, global_role, status, email_verified_at, approved_at, password_set_at)
      select u.id, lower(u.email), coalesce(u.raw_user_meta_data->>'full_name', ''),
             case when ur.role::text = 'admin' and ur.active then 'super_admin' else 'staff' end::neas.global_role,
             case when ur.active is false then 'suspended'
                  when coalesce(ur.role::text, 'viewer') = 'viewer' then 'pending'
                  else 'active' end::neas.account_status,
             u.email_confirmed_at,
             case when ur.active and coalesce(ur.role::text, 'viewer') <> 'viewer' then now() end,
             now()
      from auth.users u left join public.user_roles ur on ur.user_id = u.id
      on conflict do nothing $q$;
  else
    insert into neas.profiles (id, email, global_role, status, email_verified_at)
    select u.id, lower(u.email), 'staff', 'pending', u.email_confirmed_at from auth.users u
    on conflict do nothing;
  end if;
  get diagnostics c_profiles = row_count;
  -- pending legacy viewers appear in Pending approvals
  insert into neas.registration_requests (user_id, email, full_name)
  select p.id, p.email, p.full_name from neas.profiles p
  where p.status = 'pending' and not exists (select 1 from neas.registration_requests r where r.user_id = p.id);

  -- 2. Projects. Codes are normalised to the URL-safe pattern; the original code is
  --    kept as the reference number.
  execute $q$
    insert into neas.projects (id, code, name, reference_no, client_name, site, status, start_date, end_date, contract_value, created_by, created_at)
    select lp.id,
           case when upper(regexp_replace(lp.project_code, '[^A-Za-z0-9-]+', '-', 'g')) ~ '^[A-Z0-9][A-Z0-9-]{2,39}$'
                then upper(regexp_replace(lp.project_code, '[^A-Za-z0-9-]+', '-', 'g'))
                else 'PRJ-' || upper(left(replace(lp.id::text, '-', ''), 8)) end,
           lp.name, lp.project_code, lp.client_name, lp.location,
           (case lp.status when 'planning' then 'draft' when 'active' then 'active' when 'on_hold' then 'suspended'
                           when 'completed' then 'completed' else 'archived' end)::neas.project_status,
           lp.start_date, lp.end_date, lp.contract_value,
           (select id from neas.profiles where id = lp.created_by), lp.created_at
    from public.projects lp
    on conflict do nothing $q$;
  get diagnostics c_projects = row_count;

  -- 3. Memberships (only for accounts and projects that now exist in neas)
  if to_regclass('public.project_memberships') is not null then
    execute $q$
      insert into neas.project_memberships (project_id, user_id, role, can_approve_reports, created_at)
      select m.project_id, m.user_id,
             (case when m.project_role in ('admin', 'project_manager') then 'project_manager' else 'employee' end)::neas.project_role,
             m.project_role in ('admin', 'project_manager', 'supervisor'), m.created_at
      from public.project_memberships m
      where exists (select 1 from neas.projects p where p.id = m.project_id)
        and exists (select 1 from neas.profiles p where p.id = m.user_id)
      on conflict do nothing $q$;
    get diagnostics c_members = row_count;
  end if;

  -- 4. Activities (neas requires weight > 0; a legacy 0% weight becomes 0.01%)
  if to_regclass('public.project_activities') is not null then
    execute $q$
      insert into neas.activities (id, project_id, name, start_date, end_date, weight, sort_order, updated_by, created_at)
      select a.id, a.project_id, a.name, a.start_date, a.end_date, greatest(a.weight, 0.01), a.sort_order,
             (select id from neas.profiles where id = a.created_by), a.created_at
      from public.project_activities a
      where exists (select 1 from neas.projects p where p.id = a.project_id)
      on conflict do nothing $q$;
    get diagnostics c_acts = row_count;
  end if;

  -- 5. Field reports -> progress reports (status 'submitted': the old app had no review step)
  if to_regclass('public.field_reports') is not null then
    execute $q$
      insert into neas.project_reports (id, project_id, activity_id, report_type, report_date, actual_pct, notes, status, submitted_by, created_at)
      select r.id, r.project_id, r.activity_id, 'progress', r.report_date, r.percent_complete, r.notes, 'submitted',
             (select id from neas.profiles where id = r.reported_by), r.created_at
      from public.field_reports r
      where exists (select 1 from neas.activities a where a.id = r.activity_id)
      on conflict do nothing $q$;
    get diagnostics c_reports = row_count;
  end if;

  -- 6. BOQ / quotation records linked to a project
  if to_regclass('public.estimates') is not null then
    execute $q$
      insert into neas.boq_lines (id, project_id, item, description, unit, qty, unit_cost, updated_by, created_at)
      select md5(e.id::text || ':' || li.ord)::uuid, e.project_id, e.estimate_number,
             coalesce(nullif(trim(li.v->>'description'), ''), e.title),
             coalesce(nullif(trim(li.v->>'unit'), ''), 'lot'),
             (li.v->>'qty')::numeric, coalesce((li.v->>'rate')::numeric, 0),
             (select id from neas.profiles where id = e.created_by), e.created_at
      from public.estimates e
      cross join lateral jsonb_array_elements(case when jsonb_typeof(e.line_items) = 'array' then e.line_items else '[]'::jsonb end)
           with ordinality as li(v, ord)
      where e.project_id is not null and e.status <> 'rejected'
        and exists (select 1 from neas.projects p where p.id = e.project_id)
        and coalesce(li.v->>'qty', '') ~ '^[0-9]+(\.[0-9]+)?$' and (li.v->>'qty')::numeric > 0
        and coalesce(li.v->>'rate', '0') ~ '^[0-9]+(\.[0-9]+)?$'
      on conflict do nothing $q$;
    get diagnostics c_boq = row_count;

    -- pricing settings follow the latest legacy record (no overhead/contingency in the old app)
    execute $q$
      insert into neas.cost_settings (project_id, overhead_pct, contingency_pct, markup_pct, vat_pct, vat_mode)
      select distinct on (e.project_id) e.project_id, 0, 0, least(e.markup_percent, 100), least(e.vat_percent, 100),
             case when e.vat_percent > 0 then 'exclusive' else 'exempt' end
      from public.estimates e
      where e.project_id is not null and exists (select 1 from neas.projects p where p.id = e.project_id)
      order by e.project_id, e.created_at desc
      on conflict do nothing $q$;
    get diagnostics c_settings = row_count;

    -- quotations come across as Draft so they go through the new approval workflow
    execute $q$
      insert into neas.quotations (project_id, number, status)
      select distinct on (e.project_id) e.project_id, e.estimate_number, 'Draft'
      from public.estimates e
      where e.project_id is not null and e.record_type = 'quotation'
        and exists (select 1 from neas.projects p where p.id = e.project_id)
      order by e.project_id, e.created_at desc
      on conflict do nothing $q$;
    get diagnostics c_quotes = row_count;
  end if;

  perform neas.write_audit('system:legacy_import', null, 'database', 'public',
    jsonb_build_object('profiles', c_profiles, 'projects', c_projects, 'memberships', c_members, 'activities', c_acts,
                       'reports', c_reports, 'boq_lines', c_boq, 'cost_settings', c_settings, 'quotations', c_quotes), 'system');

  return jsonb_build_object('ok', true, 'profiles', c_profiles, 'projects', c_projects, 'memberships', c_members,
    'activities', c_acts, 'reports', c_reports, 'boq_lines', c_boq, 'cost_settings', c_settings, 'quotations', c_quotes);
end $$;

revoke all on function neas.import_legacy_public() from public, anon, authenticated;
grant execute on function neas.import_legacy_public() to service_role;
