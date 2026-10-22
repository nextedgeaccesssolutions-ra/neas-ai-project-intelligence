-- Field reports is available to every active user, whatever their module settings.
create or replace function neas.can_view(p_view text) returns boolean
language sql stable security definer set search_path = neas, extensions as $$
  select neas.is_super_admin() or (
    (p_view = 'field_reports' or exists (
      select 1 from neas.profiles p
      where p.id = auth.uid() and (p.allowed_views is null or p_view = any (p.allowed_views))
    )) and neas.is_active_user()
  );
$$;
grant execute on function neas.can_view(text) to authenticated;
