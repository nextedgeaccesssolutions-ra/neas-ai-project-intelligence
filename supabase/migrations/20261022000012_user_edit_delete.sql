-- Super Admin edits a person's name/job title, and deletes (reversibly removes) accounts.
-- Delete never erases the profile: field reports, photos and the audit log keep their author.

alter table neas.profiles add column if not exists deleted_at timestamptz;

create or replace function neas.admin_update_profile(p_user uuid, p_full_name text, p_job_title text)
returns void language plpgsql security definer set search_path = neas, extensions as $$
declare
  v_name text := btrim(regexp_replace(coalesce(p_full_name, ''), '\s+', ' ', 'g'));
  v_title text := btrim(regexp_replace(coalesce(p_job_title, ''), '\s+', ' ', 'g'));
begin
  if not neas.is_super_admin() then raise exception 'Not authorized' using errcode = '42501'; end if;
  if length(v_name) < 2 or length(v_name) > 120 or v_name ~ '[<>{}\\]' then
    raise exception 'Enter a full name of 2–120 characters';
  end if;
  if length(v_title) > 120 or v_title ~ '[<>{}\\]' then raise exception 'Job title is too long or has characters that are not allowed'; end if;
  -- the profiles audit trigger records the before/after values
  update neas.profiles set full_name = v_name, job_title = v_title where id = p_user;
  if not found then raise exception 'User not found'; end if;
end $$;

create or replace function neas.admin_delete_user(p_user uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = neas, extensions as $$
declare prof neas.profiles;
begin
  if not neas.is_super_admin() then raise exception 'Not authorized' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'You cannot delete your own account'; end if;
  select * into prof from neas.profiles where id = p_user for update;
  if not found then raise exception 'User not found'; end if;
  if prof.deleted_at is not null then raise exception 'This account is already deleted'; end if;
  if prof.global_role = 'super_admin' and prof.status = 'active'
     and (select count(*) from neas.profiles where global_role = 'super_admin' and status = 'active' and id <> p_user) = 0 then
    raise exception 'At least one active Super Admin must remain';
  end if;
  update neas.profiles set status = 'suspended', status_reason = coalesce(nullif(left(p_reason, 200), ''), 'Deleted by administrator'),
    deleted_at = now(), global_role = 'staff'
  where id = p_user;
  delete from neas.project_memberships where user_id = p_user;
  perform neas.revoke_user_sessions_(p_user);
  perform neas.write_audit('account:deleted', null, 'profiles', p_user::text,
    jsonb_build_object('email', prof.email, 'role', prof.global_role, 'reason', left(coalesce(p_reason, ''), 200)));
end $$;

-- Reactivating a deleted account brings it back (project access must be granted again).
create or replace function neas.admin_set_user_status(p_user uuid, p_status neas.account_status, p_reason text default null)
returns void language plpgsql security definer set search_path = neas, extensions as $$
begin
  if not neas.is_super_admin() then raise exception 'Not authorized' using errcode = '42501'; end if;
  if p_user = auth.uid() and p_status <> 'active' then raise exception 'You cannot suspend your own account'; end if;
  if p_status = 'pending' then raise exception 'Use registration review for pending accounts'; end if;
  update neas.profiles set status = p_status, status_reason = p_reason,
    deleted_at = case when p_status = 'active' then null else deleted_at end
  where id = p_user;
  if not found then raise exception 'User not found'; end if;
  if p_status in ('suspended', 'rejected') then perform neas.revoke_user_sessions_(p_user); end if;
end $$;

revoke execute on function neas.admin_update_profile(uuid, text, text) from public, anon;
revoke execute on function neas.admin_delete_user(uuid, text) from public, anon;
grant execute on function neas.admin_update_profile(uuid, text, text) to authenticated;
grant execute on function neas.admin_delete_user(uuid, text) to authenticated;
