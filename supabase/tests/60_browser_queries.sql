-- Every query the browser sends directly (lib/cloud, app/admin) must be allowed for the roles that
-- use it. A column-level grant that misses a column fails the whole request, so this runs each one.
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false); -- Super Admin
do $$
declare q text; failed text[] := '{}';
begin
  foreach q in array array[
    $q$select * from neas.projects$q$,
    $q$select * from neas.profiles$q$,
    $q$select id, email, full_name, global_role, status, email_verified_at, allowed_views, password_set_at from neas.profiles$q$,
    $q$select status, password_set_at from neas.profiles$q$,
    $q$select project_id, user_id, role, can_approve_reports from neas.project_memberships$q$,
    $q$select * from neas.project_invitations$q$,
    $q$select * from neas.audit_logs$q$,
    $q$select * from neas.integration_sync_log$q$,
    $q$select op_id, user_id, entity, status, result, received_at, project_id from neas.sync_operations$q$,
    $q$select id, project_id, label, created_at, expires_at, revoked_at, last_used_at, max_uses, use_count from neas.client_access_credentials$q$,
    $q$select * from neas.approved_client_content$q$,
    $q$select * from neas.registration_requests$q$,
    $q$select * from neas.activities$q$,
    $q$select * from neas.project_reports$q$,
    $q$select * from neas.report_attachments$q$,
    $q$select * from neas.boq_lines$q$,
    $q$select * from neas.cost_settings$q$,
    $q$select * from neas.quotations$q$
  ] loop
    begin
      execute q;
    exception when others then
      failed := failed || (left(q, 70) || ' -> ' || sqlerrm);
    end;
  end loop;
  perform test.check('browser queries: every Super Admin query is permitted', cardinality(failed) = 0, array_to_string(failed, ' | '));
end $$;

-- staff member: own profile + memberships load during sign-in
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a7', false);
do $$
declare q text; failed text[] := '{}';
begin
  foreach q in array array[
    $q$select id, email, full_name, global_role, status, email_verified_at, allowed_views, password_set_at from neas.profiles$q$,
    $q$select project_id, role, can_approve_reports from neas.project_memberships$q$,
    $q$select * from neas.projects$q$,
    $q$select * from neas.activities$q$,
    $q$select * from neas.project_reports$q$,
    $q$select * from neas.report_attachments$q$
  ] loop
    begin execute q; exception when others then failed := failed || (left(q, 70) || ' -> ' || sqlerrm); end;
  end loop;
  perform test.check('browser queries: every staff sign-in and workspace query is permitted', cardinality(failed) = 0, array_to_string(failed, ' | '));
end $$;
reset role;
