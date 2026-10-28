-- A share link can be kept so managers can copy it again; only the matching link, only by its managers.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
select test.setv('kept_tok2', (neas.create_report_share('10000000-0000-0000-0000-00000000000a', 'link', 7, null, 'Kept link 2', 'req-kept-002') ->> 'token'));
select test.setv('kept_id2', (select id::text from neas.report_shares where label = 'Kept link 2'));
select test.expect_error('share: a link that does not match is not kept',
  $$select neas.remember_share_link(test.v('kept_id2')::uuid, 'not-the-token')$$);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
select test.expect_error('share: an employee cannot keep a link',
  $$select neas.remember_share_link(test.v('kept_id2')::uuid, test.v('kept_tok2'))$$);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
select neas.remember_share_link(test.v('kept_id2')::uuid, test.v('kept_tok2'));
select test.check('share: the project manager sees the kept link',
  (select link_token = test.v('kept_tok2') from neas.report_shares where label = 'Kept link 2'));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
select test.check('share: an employee does not see kept links', (select count(*) = 0 from neas.report_shares where link_token is not null));
reset role;
select test.check('share: the audit log never holds a kept link',
  not exists (select 1 from neas.audit_logs where details::text like '%' || test.v('kept_tok2') || '%'));
