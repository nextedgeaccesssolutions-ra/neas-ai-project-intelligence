-- A project can be deleted (hidden) only when archived, and restored; its records stay.
select test.expect_error('project delete: an active project cannot be deleted',
  $$update neas.projects set status = 'active', deleted_at = now() where id = '10000000-0000-0000-0000-00000000000a'$$);
update neas.projects set status = 'archived' where id = '10000000-0000-0000-0000-00000000000a';
update neas.projects set deleted_at = now() where id = '10000000-0000-0000-0000-00000000000a';
select test.check('project delete: the archived project is marked deleted',
  (select deleted_at is not null from neas.projects where id = '10000000-0000-0000-0000-00000000000a'));
select test.expect_error('project delete: a deleted project cannot be reactivated without restoring',
  $$update neas.projects set status = 'active' where id = '10000000-0000-0000-0000-00000000000a'$$);
update neas.projects set deleted_at = null, status = 'active' where id = '10000000-0000-0000-0000-00000000000a';
select test.check('project delete: restored project is back', (select deleted_at is null and status = 'active' from neas.projects where id = '10000000-0000-0000-0000-00000000000a'));
