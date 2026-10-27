-- Client accounts (Overview only) do not get Field reports.
reset role;
update neas.profiles set allowed_views = array['overview'] where id = '00000000-0000-0000-0000-0000000000d1';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);
select test.check('client account: field reports and site evidence are closed', not neas.can_view('field_reports') and not neas.can_view('site_evidence') and neas.can_view('overview'));
reset role;
update neas.profiles set allowed_views = array['overview', 'projects'] where id = '00000000-0000-0000-0000-0000000000d1';
set role authenticated;
select test.check('client account: any other limited staff account keeps field reports', neas.can_view('field_reports'));
reset role;
update neas.profiles set allowed_views = null where id = '00000000-0000-0000-0000-0000000000d1';
