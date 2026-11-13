-- Report sharing links and Super Admin resolution of offline sync problems.
reset role;
select set_config('request.jwt.claim.sub', '', false);
insert into neas.report_attachments (id, project_id, kind, storage_path, mime_type, bytes, uploaded_by, deleted_at, version)
values ('50000000-0000-0000-0000-0000000000f5', '10000000-0000-0000-0000-00000000000a', 'during', '10000000-0000-0000-0000-00000000000a/gone.jpg', 'image/jpeg', 10,
  '00000000-0000-0000-0000-0000000000b1', now(), 3);

-- a delete of an already-deleted photo is applied, not a conflict
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
select test.check('sync: deleting an already-deleted record is applied (no conflict)',
  (neas.apply_operation(jsonb_build_object('op_id', '70000000-0000-0000-0000-0000000000f1', 'entity', 'report_attachments', 'op', 'delete',
    'record_id', '50000000-0000-0000-0000-0000000000f5', 'project_id', '10000000-0000-0000-0000-00000000000a', 'base_version', 1)) ->> 'status') = 'applied');

-- an old conflict recorded before the fix
reset role;
insert into neas.sync_operations (op_id, user_id, project_id, entity, record_id, op, base_version, status, result)
values ('70000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-00000000000a', 'report_attachments',
  '50000000-0000-0000-0000-0000000000f5', 'delete', 1, 'conflict', '{"status":"conflict"}');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
select test.expect_error('sync: only a Super Admin resolves sync problems',
  $$select neas.resolve_sync_operation('70000000-0000-0000-0000-0000000000f2', 'dismiss')$$);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select test.check('sync: resolving a delete whose record is already gone is recorded as already applied',
  neas.resolve_sync_operation('70000000-0000-0000-0000-0000000000f2', 'apply_delete', 'photo already removed') = 'already_applied');
select test.expect_error('sync: a resolved problem cannot be resolved twice',
  $$select neas.resolve_sync_operation('70000000-0000-0000-0000-0000000000f2', 'dismiss')$$);
reset role;
select test.check('sync: the resolution is in the audit log',
  exists (select 1 from neas.audit_logs where action = 'sync:resolved' and details ->> 'outcome' = 'already_applied' and actor_id = '00000000-0000-0000-0000-0000000000a1'));

-- shares
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
select test.expect_error('share: an employee cannot share a project',
  $$select neas.create_report_share('10000000-0000-0000-0000-00000000000a', 'link', 7)$$);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
select test.expect_error('share: links last at most 90 days',
  $$select neas.create_report_share('10000000-0000-0000-0000-00000000000a', 'link', 91)$$);
select test.expect_error('share: an e-mail share needs a valid recipient',
  $$select neas.create_report_share('10000000-0000-0000-0000-00000000000a', 'email', 7, 'not-an-email')$$);
select test.expect_error('share: the project manager cannot share another project',
  $$select neas.create_report_share('10000000-0000-0000-0000-00000000000b', 'link', 7)$$);
select test.setv('share_tok', (neas.create_report_share('10000000-0000-0000-0000-00000000000a', 'qr', 7, null, 'Site board', 'req-0000001') ->> 'token'));
select test.expect_error('share: a repeated request does not create a second link',
  $$select neas.create_report_share('10000000-0000-0000-0000-00000000000a', 'qr', 7, null, 'Site board', 'req-0000001')$$);
select test.check('share: the manager sees the share; the raw token is not stored',
  (select count(*) = 1 and bool_and(token_hash <> test.v('share_tok') and length(token_hash) = 64) from neas.report_shares where project_id = '10000000-0000-0000-0000-00000000000a'));
select test.expect_error('share: shares cannot be edited directly',
  $$update neas.report_shares set expires_at = now() + interval '1 year'$$);
select test.expect_error('share: users cannot open a link through the database',
  $$select neas.share_snapshot(test.v('share_tok'))$$);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
select test.check('share: an employee does not see share links', (select count(*) = 0 from neas.report_shares));

reset role;
set role service_role;
select test.check('share: a valid link opens the approved project view',
  (select (neas.share_snapshot(test.v('share_tok')) -> 'project' ->> 'code') = 'PRJ-2026-001'));
select test.expect_error('share: a wrong token is refused', $$select neas.share_snapshot('not-a-real-token')$$);
reset role;
select test.check('share: opening is counted and logged once',
  (select s.open_count = 1 and (select count(*) from neas.report_share_events e where e.share_id = s.id and e.event = 'opened') = 1 from neas.report_shares s where s.label = 'Site board'));

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
select neas.revoke_report_share((select id from neas.report_shares where label = 'Site board'));
reset role;
set role service_role;
select test.expect_error('share: a revoked link no longer opens', $$select neas.share_snapshot(test.v('share_tok'))$$);
reset role;

-- expiry is checked on every open
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select test.setv('share_tok2', (neas.create_report_share('10000000-0000-0000-0000-00000000000a', 'link', 1) ->> 'token'));
reset role;
update neas.report_shares set created_at = now() - interval '3 days', expires_at = now() - interval '1 day' where token_hash = encode(extensions.digest(test.v('share_tok2'), 'sha256'), 'hex');
set role service_role;
select test.expect_error('share: an expired link no longer opens', $$select neas.share_snapshot(test.v('share_tok2'))$$);
reset role;
select set_config('request.jwt.claim.sub', '', false);

-- turning client access off closes shared links immediately
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select test.setv('share_tok3', (neas.create_report_share('10000000-0000-0000-0000-00000000000a', 'link', 7) ->> 'token'));
reset role;
update neas.projects set client_portal_enabled = false where id = '10000000-0000-0000-0000-00000000000a';
set role service_role;
select test.expect_error('share: links stop working when client access is turned off', $$select neas.share_snapshot(test.v('share_tok3'))$$);
reset role;
update neas.projects set client_portal_enabled = true where id = '10000000-0000-0000-0000-00000000000a';
select set_config('request.jwt.claim.sub', '', false);
