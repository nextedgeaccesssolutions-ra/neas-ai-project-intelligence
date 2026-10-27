-- Client review and approval of project reports.
-- Staff send one generated PDF to the project's clients; the exact file (path + SHA-256) is fixed at
-- that moment. The client approves or requests changes for that file only; a newer report needs its
-- own review. Clients act through their portal session (server-side), never with a Supabase account.

alter table neas.project_report_exports add column if not exists review_file_path text;
alter table neas.project_report_exports add column if not exists review_sha256 text;
alter table neas.project_report_exports add column if not exists sent_for_review_at timestamptz;
alter table neas.project_report_exports add column if not exists sent_for_review_by uuid references neas.profiles (id);
alter table neas.project_report_exports drop constraint if exists project_report_exports_approval_status_check;
alter table neas.project_report_exports add constraint project_report_exports_approval_status_check
  check (approval_status in ('not_recorded', 'pending', 'approved', 'changes_requested'));

-- a newly logged report always starts unreviewed: review state changes only through the functions below
drop policy if exists project_report_exports_insert on neas.project_report_exports;
create policy project_report_exports_insert on neas.project_report_exports for insert to authenticated
  with check ((neas.is_super_admin() or neas.is_member(project_id)) and generated_by = auth.uid()
              and approval_status = 'not_recorded' and review_file_path is null and review_sha256 is null
              and sent_for_review_at is null and sent_for_review_by is null);

create table if not exists neas.client_report_reviews (
  id uuid primary key default gen_random_uuid(),
  export_id uuid not null references neas.project_report_exports (id) on delete cascade,
  project_id uuid not null references neas.projects (id) on delete cascade,
  credential_id uuid references neas.client_access_credentials (id) on delete set null,
  reviewer_name text not null check (length(btrim(reviewer_name)) between 2 and 120),
  decision text not null check (decision in ('approved', 'changes_requested')),
  comment text not null default '' check (length(comment) <= 2000),
  file_sha256 text not null,
  created_at timestamptz not null default now()
);
create index if not exists client_report_reviews_export on neas.client_report_reviews (export_id, created_at desc);
alter table neas.client_report_reviews enable row level security;
revoke all on neas.client_report_reviews from anon, authenticated;
grant select on neas.client_report_reviews to authenticated;
grant all on neas.client_report_reviews to service_role;
drop policy if exists client_report_reviews_read on neas.client_report_reviews;
create policy client_report_reviews_read on neas.client_report_reviews for select to authenticated
  using (neas.is_super_admin() or neas.is_member(project_id));

-- staff: fix the file a client will review (the server uploads it first)
create or replace function neas.send_report_for_review(p_export uuid, p_path text, p_sha256 text)
returns void language plpgsql security definer set search_path = neas, extensions as $$
declare e neas.project_report_exports%rowtype;
begin
  select * into e from neas.project_report_exports where id = p_export for update;
  if not found then raise exception 'Report not found' using errcode = 'P0002'; end if;
  if not (neas.is_super_admin() or neas.is_manager(e.project_id)) then
    raise exception 'Only a project manager or Super Admin can send a report to the client' using errcode = '42501';
  end if;
  if p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'Invalid file fingerprint' using errcode = '22023'; end if;
  -- content-addressed: the path names the file's own fingerprint, so a stored review file is never replaced
  if p_path is distinct from ('client-reviews/' || e.project_id::text || '/' || e.id::text || '/' || p_sha256 || '.pdf') then
    raise exception 'Invalid review file' using errcode = '22023';
  end if;
  if e.approval_status = 'approved' then
    raise exception 'This report is already approved by the client. Generate a new report for further changes.' using errcode = '22023';
  end if;
  update neas.project_report_exports
     set review_file_path = p_path, review_sha256 = p_sha256, sent_for_review_at = now(), sent_for_review_by = auth.uid(), approval_status = 'pending'
   where id = e.id;
  insert into neas.audit_logs (actor_id, action, project_id, target_type, target_id, details)
    values (auth.uid(), 'report:sent_for_client_review', e.project_id, 'project_report_exports', e.id::text,
            jsonb_build_object('report_ref', e.report_ref, 'sha256', p_sha256));
end $$;

-- the client session behind a portal token (same rules as client_snapshot)
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
    and p.client_portal_enabled and p.status in ('active', 'completed');
  if not found then raise exception 'Session expired' using errcode = 'P0401'; end if;
  return s;
end $$;

-- client: reports sent for review on their project, newest first, with the latest decision
create or replace function neas.client_reports(p_token text)
returns jsonb language plpgsql security definer set search_path = neas, extensions as $$
declare s neas.client_sessions%rowtype;
begin
  s := neas.client_session_for(p_token);
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', e.id, 'report_ref', e.report_ref, 'period_from', e.period_from, 'period_to', e.period_to,
      'generated_at', e.generated_at, 'sent_at', e.sent_for_review_at, 'status', e.approval_status,
      'file_path', e.review_file_path, 'sha256', e.review_sha256,
      'review', (select jsonb_build_object('name', r.reviewer_name, 'decision', r.decision, 'comment', r.comment, 'at', r.created_at)
                 from neas.client_report_reviews r where r.export_id = e.id order by r.created_at desc limit 1))
      order by e.sent_for_review_at desc)
    from neas.project_report_exports e
    where e.project_id = s.project_id and e.review_file_path like 'client-reviews/' || s.project_id::text || '/%'), '[]'::jsonb);
end $$;

-- client: approve or request changes on the exact file they were shown
create or replace function neas.client_review_report(p_token text, p_export uuid, p_decision text, p_name text, p_comment text, p_sha256 text)
returns text language plpgsql security definer set search_path = neas, extensions as $$
declare
  s neas.client_sessions%rowtype;
  e neas.project_report_exports%rowtype;
begin
  s := neas.client_session_for(p_token);
  select * into e from neas.project_report_exports where id = p_export and project_id = s.project_id for update;
  if not found or e.review_file_path is null then raise exception 'Report not found' using errcode = 'P0002'; end if;
  if e.approval_status <> 'pending' then raise exception 'This report has already been reviewed.' using errcode = '22023'; end if;
  if p_sha256 is distinct from e.review_sha256 then
    raise exception 'This report was replaced by a newer version. Reload and review the current one.' using errcode = '22023';
  end if;
  if p_decision not in ('approved', 'changes_requested') then raise exception 'Choose Approve or Request changes' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'Enter your name' using errcode = '22023'; end if;
  if p_decision = 'changes_requested' and length(btrim(coalesce(p_comment, ''))) < 3 then
    raise exception 'Say what should change' using errcode = '22023';
  end if;
  insert into neas.client_report_reviews (export_id, project_id, credential_id, reviewer_name, decision, comment, file_sha256)
    values (e.id, e.project_id, s.credential_id, left(btrim(p_name), 120), p_decision, left(btrim(coalesce(p_comment, '')), 2000), e.review_sha256);
  update neas.project_report_exports set approval_status = p_decision where id = e.id;
  insert into neas.audit_logs (actor_kind, action, project_id, target_type, target_id, details)
    values ('client', 'client:report_' || p_decision, e.project_id, 'project_report_exports', e.id::text,
            jsonb_build_object('report_ref', e.report_ref, 'name', btrim(p_name), 'sha256', e.review_sha256));
  return p_decision;
end $$;

revoke all on function neas.send_report_for_review(uuid, text, text) from public, anon;
grant execute on function neas.send_report_for_review(uuid, text, text) to authenticated, service_role;
revoke all on function neas.client_session_for(text) from public, anon, authenticated;
grant execute on function neas.client_session_for(text) to service_role;
revoke all on function neas.client_reports(text) from public, anon, authenticated;
grant execute on function neas.client_reports(text) to service_role;
revoke all on function neas.client_review_report(text, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function neas.client_review_report(text, uuid, text, text, text, text) to service_role;
