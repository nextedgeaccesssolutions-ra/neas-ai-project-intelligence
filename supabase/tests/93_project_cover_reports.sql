-- Cover photos and project report log.
reset role;
select set_config('request.jwt.claim.sub', '', false);
insert into neas.report_attachments (id, project_id, kind, storage_path, mime_type, bytes, captured_at, cover_category, photo_ref)
values ('50000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-0000000000d1', 'reference', '10000000-0000-0000-0000-0000000000d1/ref1.jpg', 'image/jpeg', 1000, now(), 'main_building', 'REF-1');
select test.check('cover: a reference (building) photo can be stored', exists (select 1 from neas.report_attachments where id = '50000000-0000-0000-0000-0000000000f1' and kind = 'reference'));
select test.expect_error('cover: an unknown cover category is refused',
  $$update neas.report_attachments set cover_category = 'lobby' where id = '50000000-0000-0000-0000-0000000000f1'$$);
select test.expect_error('cover: a primary photo must be on the cover',
  $$update neas.report_attachments set cover_primary = true where id = '50000000-0000-0000-0000-0000000000f1'$$);

insert into neas.project_memberships (project_id, user_id, role) values
  ('10000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d1', 'employee') on conflict do nothing;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);
do $$ begin
  update neas.report_attachments set is_cover = true where id = '50000000-0000-0000-0000-0000000000f1';
exception when others then null; end $$;
reset role;
select test.check('cover: a field employee cannot put a photo on the cover',
  (select not is_cover from neas.report_attachments where id = '50000000-0000-0000-0000-0000000000f1'));
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
update neas.report_attachments set is_cover = true, cover_order = 1, cover_primary = true where id = '50000000-0000-0000-0000-0000000000f1';
select test.check('cover: the project manager chooses the cover photo and primary',
  (select is_cover and cover_primary and cover_order = 1 from neas.report_attachments where id = '50000000-0000-0000-0000-0000000000f1'));

insert into neas.project_report_exports (project_id, report_ref, planned_pct, actual_pct, schedule_status)
values ('10000000-0000-0000-0000-0000000000d1', 'PRJ-2026-091-PR-20261023-1200', 60, 40, 'Behind schedule');
select test.check('reports: a generated report is logged with its author',
  (select generated_by = '00000000-0000-0000-0000-0000000000b1' from neas.project_report_exports where report_ref = 'PRJ-2026-091-PR-20261023-1200'));
select test.expect_error('reports: the author cannot be someone else',
  $$insert into neas.project_report_exports (project_id, report_ref, generated_by) values ('10000000-0000-0000-0000-0000000000d1', 'X-1-PR', '00000000-0000-0000-0000-0000000000a1')$$);
select test.expect_error('reports: the report log cannot be edited',
  $$update neas.project_report_exports set actual_pct = 99 where report_ref = 'PRJ-2026-091-PR-20261023-1200'$$);
reset role;
delete from neas.project_memberships where project_id = '10000000-0000-0000-0000-0000000000d1' and user_id = '00000000-0000-0000-0000-0000000000d1';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);
select test.check('reports: non-members cannot read the report log',
  not exists (select 1 from neas.project_report_exports where project_id = '10000000-0000-0000-0000-0000000000d1'));
reset role;
select set_config('request.jwt.claim.sub', '', false);
