-- More lists for saved groups and personal hiding (projects, activities, BOQ, field reports).
reset role;
select set_config('request.jwt.claim.sub', '', false);
insert into neas.project_memberships (project_id, user_id, role) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000d1', 'employee') on conflict do nothing;
insert into neas.activities (id, project_id, name, start_date, end_date, weight)
values ('a0000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-00000000000a', 'Org test activity', current_date, current_date + 5, 1)
on conflict do nothing;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);
-- personal groups of projects (no project of their own)
insert into neas.view_groups (id, project_id, list_key, scope, name) values ('81000000-0000-0000-0000-0000000000a1', null, 'projects', 'personal', 'Window cleaning');
select test.check('lists: a person groups the projects they belong to',
  neas.move_items_to_group('81000000-0000-0000-0000-0000000000a1', 'project', array['10000000-0000-0000-0000-00000000000a']::uuid[]) = 1);
select test.expect_error('lists: projects the person is not on cannot be grouped',
  $$select neas.move_items_to_group('81000000-0000-0000-0000-0000000000a1', 'project', array['10000000-0000-0000-0000-0000000000ff']::uuid[])$$);
select test.expect_error('lists: a project group cannot be shared with a project',
  $$insert into neas.view_groups (project_id, list_key, scope, name) values (null, 'projects', 'project', 'Shared projects')$$);
select test.expect_error('lists: projects cannot go into an activity group',
  $$insert into neas.view_groups (id, project_id, list_key, scope, name) values ('81000000-0000-0000-0000-0000000000a9', '10000000-0000-0000-0000-00000000000a', 'activities', 'personal', 'Wrong');
    select neas.move_items_to_group('81000000-0000-0000-0000-0000000000a9', 'project', array['10000000-0000-0000-0000-00000000000a']::uuid[])$$);
-- activities, action center and hiding a project
insert into neas.view_groups (id, project_id, list_key, scope, name) values ('81000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-00000000000a', 'actions', 'personal', 'This week');
select test.check('lists: action-center items (activities) can be grouped',
  neas.move_items_to_group('81000000-0000-0000-0000-0000000000a2', 'activity', array['a0000000-0000-0000-0000-0000000000f1']::uuid[]) = 1);
insert into neas.hidden_items (project_id, item_kind, item_id) values ('10000000-0000-0000-0000-00000000000a', 'project', '10000000-0000-0000-0000-00000000000a');
select test.check('lists: a person can hide a project from their own register', exists (select 1 from neas.hidden_items where item_kind = 'project'));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
select test.check('lists: personal project groups and hidden projects stay private',
  (select count(*) = 0 from neas.view_groups where list_key in ('projects', 'actions')) and (select count(*) = 0 from neas.hidden_items where item_kind = 'project'));
reset role;
select test.check('lists: grouping and hiding never change the projects or activities',
  (select count(*) = 2 from neas.projects where id in ('10000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-00000000000b') and status = 'active')
  and exists (select 1 from neas.activities where id = 'a0000000-0000-0000-0000-0000000000f1' and deleted_at is null));
delete from neas.view_groups where id in ('81000000-0000-0000-0000-0000000000a1', '81000000-0000-0000-0000-0000000000a2', '81000000-0000-0000-0000-0000000000a9');
delete from neas.hidden_items where item_kind = 'project';
delete from neas.project_memberships where project_id = '10000000-0000-0000-0000-00000000000a' and user_id = '00000000-0000-0000-0000-0000000000d1';
select set_config('request.jwt.claim.sub', '', false);
