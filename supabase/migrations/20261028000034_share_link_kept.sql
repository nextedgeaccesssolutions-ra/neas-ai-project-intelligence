-- Share links can be copied again from the "Links for this project" list.
-- The link itself is kept beside its fingerprint for links made from now on (the owner's choice: convenience over
-- "shown once"). Only Super Admins and the project's managers can read it, through the existing select policy.
-- Links made before this change cannot be recovered (only their fingerprint was stored).
alter table neas.report_shares add column if not exists link_token text;

-- Keep a link: only for a link of a project the caller manages, and only the token that matches its fingerprint.
create or replace function neas.remember_share_link(p_share uuid, p_token text)
returns void language plpgsql security definer set search_path = neas, extensions as $$
declare r neas.report_shares%rowtype;
begin
  select * into r from neas.report_shares where id = p_share;
  if not found then raise exception 'Link not found' using errcode = 'P0002'; end if;
  if not (neas.is_super_admin() or neas.is_manager(r.project_id)) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if p_token is null or encode(digest(p_token, 'sha256'), 'hex') <> r.token_hash then
    raise exception 'This is not the link that was created' using errcode = '22023';
  end if;
  update neas.report_shares set link_token = p_token where id = p_share;
end $$;
revoke all on function neas.remember_share_link(uuid, text) from public;
grant execute on function neas.remember_share_link(uuid, text) to authenticated;

-- The audit log records changes but never the kept link itself (it would outlive withdrawing the link).
create or replace function neas.audit_row() returns trigger
language plpgsql security definer set search_path = neas, extensions as $$
declare
  rec jsonb := to_jsonb(coalesce(new, old)) - 'link_token';
  diff jsonb := '{}'::jsonb;
  k text;
begin
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(to_jsonb(new)) loop
      if k not in ('updated_at', 'version', 'passcode_hash', 'link_token') and (to_jsonb(new) -> k) is distinct from (to_jsonb(old) -> k) then
        diff := diff || jsonb_build_object(k, jsonb_build_object('from', to_jsonb(old) -> k, 'to', to_jsonb(new) -> k));
      end if;
    end loop;
    if diff = '{}'::jsonb then return new; end if;
  end if;
  insert into neas.audit_logs (actor_id, action, project_id, target_type, target_id, details)
  values (
    auth.uid(),
    lower(tg_op) || ':' || tg_table_name,
    case when rec ? 'project_id' then (rec ->> 'project_id')::uuid when tg_table_name = 'projects' then (rec ->> 'id')::uuid end,
    tg_table_name,
    coalesce(rec ->> 'id', rec ->> 'user_id'),
    case when tg_op = 'UPDATE' then diff else rec - 'passcode_hash' end
  );
  return coalesce(new, old);
end $$;
