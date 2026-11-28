-- Reschedule segment for an activity: when work stops and resumes later, the remaining work gets its
-- own New start / New finish, drawn as a second bar after the original one. The original baseline and
-- planned dates are kept, so planned-versus-actual still measures against the original plan.

alter table neas.activities add column if not exists reschedule_start date;
alter table neas.activities add column if not exists reschedule_end date;
alter table neas.activities drop constraint if exists activities_reschedule_check;
alter table neas.activities add constraint activities_reschedule_check check (
  (reschedule_start is null) = (reschedule_end is null)
  and (reschedule_end is null or reschedule_end >= reschedule_start)
);
