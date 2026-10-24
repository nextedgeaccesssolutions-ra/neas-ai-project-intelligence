-- Saved groups and personal hidden items: view only, never changes the files.
reset role;
select set_config('request.jwt.claim.sub', '', false);
insert into neas.report_attachments (id, project_id, kind, storage_path, mime_type, bytes, uploaded_by) values
  ('50000000-0000-0000-0000-0000000000a6', '10000000-0000-0000-0000-00000000000a', 'before', '10000000-0000-0000-0000-00000000000a/g1.jpg', 'image/jpeg', 10, '00000000-0000-0000-0000-0000000000d1'),
  ('50000000-0000-0000-0000-0000000000a7', '10000000-0000-0000-0000-00000000000a', 'after', '10000000-0000-0000-0000-00000000000a/g2.jpg', 'image/jpeg', 10, '00000000-0000-0000-0000-0000000000d1'),
  ('50000000-0000-0000-0000-0000000000b6', '10000000-0000-0000-0000-00000000000b', 'before', '10000000-0000-0000-0000-00000000000b/g3.jpg', 'image/jpeg', 10, '00000000-0000-0000-0000-0000000000d1');
insert into neas.project_memberships (project_id, user_id, role) values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000d1', 'employee') on conflict do nothing;
select test.setv('att_before', (select md5(string_agg(to_jsonb(f)::text, '' order by id)) from neas.report_attachments f where id::text like '50000000-0000-0000-0000-0000000000_6' or id = '50000000-0000-0000-0000-0000000000a7'));

-- an employee makes a personal group
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);
insert into neas.view_groups (id, project_id, list_key, scope, name) values ('80000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-00000000000a', 'evidence', 'personal', 'North facade');
select test.check('view: an employee can create a personal group', neas.move_items_to_group('80000000-0000-0000-0000-0000000000a1', 'attachment', array['50000000-0000-0000-0000-0000000000a6', '50000000-0000-0000-0000-0000000000a7']::uuid[]) = 2);
select test.expect_error('view: an employee cannot create a shared project group',
  $$insert into neas.view_groups (project_id, list_key, scope, name) values ('10000000-0000-0000-0000-00000000000a', 'evidence', 'project', 'Shared')$$);
select test.expect_error('view: items from another project cannot be grouped',
  $$select neas.move_items_to_group('80000000-0000-0000-0000-0000000000a1', 'attachment', array['50000000-0000-0000-0000-0000000000b6']::uuid[])$$);
select test.expect_error('view: a report cannot go into a photo group',
  $$select neas.move_items_to_group('80000000-0000-0000-0000-0000000000a1', 'field_report', array['50000000-0000-0000-0000-0000000000a6']::uuid[])$$);
insert into neas.view_groups (id, project_id, list_key, scope, name) values ('80000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', 'evidence', 'personal', 'South');
select neas.move_items_to_group('80000000-0000-0000-0000-0000000000a2', 'attachment', array['50000000-0000-0000-0000-0000000000a7']::uuid[]);
select test.check('view: moving an item leaves its old group (one group per view)',
  (select count(*) = 1 from neas.view_group_items where item_id = '50000000-0000-0000-0000-0000000000a7') and
  (select group_id = '80000000-0000-0000-0000-0000000000a2' from neas.view_group_items where item_id = '50000000-0000-0000-0000-0000000000a7'));
insert into neas.hidden_items (project_id, item_kind, item_id) values ('10000000-0000-0000-0000-00000000000a', 'attachment', '50000000-0000-0000-0000-0000000000a6');
select test.expect_error('view: hiding an item from another project is refused',
  $$insert into neas.hidden_items (project_id, item_kind, item_id) values ('10000000-0000-0000-0000-00000000000a', 'attachment', '50000000-0000-0000-0000-0000000000b6')$$);

-- the project manager sees none of the employee's personal view, and makes a shared group
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
select test.check('view: personal groups and hidden items are private',
  (select count(*) = 0 from neas.view_groups where scope = 'personal') and (select count(*) = 0 from neas.hidden_items) and (select count(*) = 0 from neas.view_group_items));
select test.expect_error('view: nobody edits someone else''s personal group',
  $$select neas.move_items_to_group('80000000-0000-0000-0000-0000000000a1', 'attachment', array['50000000-0000-0000-0000-0000000000a7']::uuid[])$$);
insert into neas.view_groups (id, project_id, list_key, scope, name) values ('80000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-00000000000a', 'evidence', 'project', 'Week 1');
select neas.move_items_to_group('80000000-0000-0000-0000-0000000000b1', 'attachment', array['50000000-0000-0000-0000-0000000000a7']::uuid[]);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);
select test.check('view: shared and personal grouping are independent views',
  (select count(*) = 2 from neas.view_group_items where item_id = '50000000-0000-0000-0000-0000000000a7'));
select test.check('view: members see the shared group', exists (select 1 from neas.view_groups where id = '80000000-0000-0000-0000-0000000000b1'));
update neas.view_groups set name = 'Mine' where id = '80000000-0000-0000-0000-0000000000b1';
select test.check('view: the employee''s rename of a shared group changes nothing', (select name = 'Week 1' from neas.view_groups where id = '80000000-0000-0000-0000-0000000000b1'));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', false);
select test.check('view: other projects do not see the shared group', not exists (select 1 from neas.view_groups where id = '80000000-0000-0000-0000-0000000000b1'));

-- removing groups keeps every file
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);
delete from neas.view_groups where id in ('80000000-0000-0000-0000-0000000000a1', '80000000-0000-0000-0000-0000000000a2');
delete from neas.hidden_items where item_id = '50000000-0000-0000-0000-0000000000a6';
reset role;
select test.check('view: ungrouping, deleting groups and unhiding never change the files',
  test.v('att_before') = (select md5(string_agg(to_jsonb(f)::text, '' order by id)) from neas.report_attachments f where id::text like '50000000-0000-0000-0000-0000000000_6' or id = '50000000-0000-0000-0000-0000000000a7'));
select test.check('view: deleting a group removes only its memberships',
  (select count(*) = 1 from neas.view_group_items where item_id = '50000000-0000-0000-0000-0000000000a7') and (select count(*) = 3 from neas.report_attachments where id in ('50000000-0000-0000-0000-0000000000a6', '50000000-0000-0000-0000-0000000000a7', '50000000-0000-0000-0000-0000000000b6')));
select test.check('view: shared group changes are audited', exists (select 1 from neas.audit_logs where action = 'insert:view_groups' and target_id = '80000000-0000-0000-0000-0000000000b1'));
select set_config('request.jwt.claim.sub', '', false);
delete from neas.project_memberships where project_id = '10000000-0000-0000-0000-00000000000a' and user_id = '00000000-0000-0000-0000-0000000000d1';
