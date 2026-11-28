-- Client accounts (staff profiles whose only module is Overview) do not get Field reports or Site
-- evidence. Every other active user keeps Field reports, as in migration 000013.
create or replace function neas.can_view(p_view text) returns boolean
language sql stable security definer set search_path = neas, extensions as $$
  select neas.is_super_admin() or (
    exists (
      select 1 from neas.profiles p
      where p.id = auth.uid()
        and (p.allowed_views is null
             or p_view = any (p.allowed_views)
             or (p_view = 'field_reports' and p.allowed_views is distinct from array['overview']::text[]))
    ) and neas.is_active_user()
  );
$$;
grant execute on function neas.can_view(text) to authenticated;
