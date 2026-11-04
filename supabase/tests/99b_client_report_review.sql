-- Client review and approval of project reports.
reset role;
insert into neas.projects (id, code, name, status, client_portal_enabled) values ('10000000-0000-0000-0000-000000000098', 'PRJ-2026-098', 'Client review', 'active', true);
insert into neas.project_report_exports (id, project_id, report_ref) values
  ('20000000-0000-0000-0000-000000000098', '10000000-0000-0000-0000-000000000098', 'PRJ-2026-098-PR-1'),
  ('20000000-0000-0000-0000-000000000097', '10000000-0000-0000-0000-000000000099', 'OTHER-PR-1');

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);
select test.expect_error('review: staff who are not managers cannot send a report to the client',
  $$select neas.send_report_for_review('20000000-0000-0000-0000-000000000098', 'client-reviews/10000000-0000-0000-0000-000000000098/20000000-0000-0000-0000-000000000098/' || repeat('a', 64) || '.pdf', repeat('a', 64))$$);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select test.expect_error('review: the file path must be the fixed review path',
  $$select neas.send_report_for_review('20000000-0000-0000-0000-000000000098', 'client-reviews/other/x.pdf', repeat('a', 64))$$);
select neas.send_report_for_review('20000000-0000-0000-0000-000000000098', 'client-reviews/10000000-0000-0000-0000-000000000098/20000000-0000-0000-0000-000000000098/' || repeat('a', 64) || '.pdf', repeat('a', 64));
select neas.admin_create_client_login('10000000-0000-0000-0000-000000000098', 'Client reviewer', 'review.client', '582913');
reset role;
select test.check('review: sending marks the report pending', (select approval_status = 'pending' and review_sha256 = repeat('a', 64) from neas.project_report_exports where id = '20000000-0000-0000-0000-000000000098'));
select test.check('review: client functions are server-only',
  not has_function_privilege('authenticated', 'neas.client_review_report(text,uuid,text,text,text,text)', 'execute')
  and not has_function_privilege('anon', 'neas.client_reports(text)', 'execute'));

set role service_role;
create temp table rv_tok as select session_token as t from neas.client_login_username('review.client', '582913', 'ip-rv');
select test.check('review: the client sees the report sent to them', (select jsonb_array_length(neas.client_reports((select t from rv_tok))) = 1));
select test.expect_error('review: a client cannot review another project''s report',
  $$select neas.client_review_report((select t from rv_tok), '20000000-0000-0000-0000-000000000097', 'approved', 'Ana Cruz', '', repeat('a', 64))$$);
select test.expect_error('review: approval is locked to the exact file shown',
  $$select neas.client_review_report((select t from rv_tok), '20000000-0000-0000-0000-000000000098', 'approved', 'Ana Cruz', '', repeat('b', 64))$$);
select test.expect_error('review: requesting changes needs a comment',
  $$select neas.client_review_report((select t from rv_tok), '20000000-0000-0000-0000-000000000098', 'changes_requested', 'Ana Cruz', '', repeat('a', 64))$$);
select test.check('review: the client approves', neas.client_review_report((select t from rv_tok), '20000000-0000-0000-0000-000000000098', 'approved', 'Ana Cruz', 'OK', repeat('a', 64)) = 'approved');
select test.expect_error('review: a decided report cannot be reviewed again',
  $$select neas.client_review_report((select t from rv_tok), '20000000-0000-0000-0000-000000000098', 'changes_requested', 'Ana Cruz', 'redo it', repeat('a', 64))$$);
select test.expect_error('review: a bad session token is refused', $$select neas.client_reports('nope')$$);
reset role;
select test.check('review: decision and reviewer are recorded', (select approval_status = 'approved' from neas.project_report_exports where id = '20000000-0000-0000-0000-000000000098')
  and (select reviewer_name = 'Ana Cruz' and file_sha256 = repeat('a', 64) from neas.client_report_reviews where export_id = '20000000-0000-0000-0000-000000000098'));
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select test.expect_error('review: an approved report cannot be re-sent',
  $$select neas.send_report_for_review('20000000-0000-0000-0000-000000000098', 'client-reviews/10000000-0000-0000-0000-000000000098/20000000-0000-0000-0000-000000000098/' || repeat('c', 64) || '.pdf', repeat('c', 64))$$);
reset role;
drop table rv_tok;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select test.expect_error('review: staff cannot log a report that is already approved',
  $$insert into neas.project_report_exports (project_id, report_ref, approval_status, generated_by) values ('10000000-0000-0000-0000-000000000098', 'FAKE-APPROVED-1', 'approved', auth.uid())$$);
reset role;
