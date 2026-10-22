-- One-time reset: every existing account gets all 9 workspace modules (null = all).
-- New accounts already start with null. Super Admins can still narrow a person's modules later.
do $$
declare r record;
begin
  for r in select id, allowed_views from neas.profiles where allowed_views is not null loop
    update neas.profiles set allowed_views = null where id = r.id;
    insert into neas.audit_logs (actor_kind, action, target_type, target_id, details)
    values ('system', 'account:views_changed', 'profiles', r.id::text,
            jsonb_build_object('from', to_jsonb(r.allowed_views), 'to', null, 'reason', 'All modules enabled for every user'));
  end loop;
end $$;
