-- Super Admins can delete an archived project from the Control panel. Deleting only hides it (its reports,
-- photos and history stay and it can be restored): a hard delete would cascade through every record.
-- Only an archived project can be deleted, so members already have no access to it.
alter table neas.projects add column if not exists deleted_at timestamptz;
alter table neas.projects drop constraint if exists projects_deleted_archived;
alter table neas.projects add constraint projects_deleted_archived check (deleted_at is null or status = 'archived');
