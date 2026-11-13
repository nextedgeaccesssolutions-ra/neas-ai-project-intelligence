-- Site Evidence locations: GPS source, required photos, client access to photo locations.
reset role;
select set_config('request.jwt.claim.sub', '', false);
update neas.report_attachments set client_visible = true, gps_source = 'device' where id = '50000000-0000-0000-0000-0000000000e1';
select test.expect_error('locations: an unknown GPS source is refused',
  $$update neas.report_attachments set gps_source = 'guess' where id = '50000000-0000-0000-0000-0000000000e1'$$);
select test.expect_error('locations: a negative required photo count is refused',
  $$update neas.activities set required_photos = -1 where project_id = '10000000-0000-0000-0000-00000000000a'$$);
update neas.approved_client_content set show_photos = true where project_id = '10000000-0000-0000-0000-00000000000a';

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select test.setv('code9', neas.admin_create_client_passcode('10000000-0000-0000-0000-00000000000a', 'Location test', null, false));
reset role;
set role service_role;
select test.setv('tok9', (select session_token from neas.client_login('PRJ-2026-001', test.v('code9'), 'ip-loc-92') where ok));
select test.setv('snap9', neas.client_snapshot(test.v('tok9'))::text);
select test.check('locations: clients see the recorded location, accuracy and source by default',
  exists (select 1 from jsonb_array_elements(test.v('snap9')::jsonb -> 'files') f
          where f ->> 'id' = '50000000-0000-0000-0000-0000000000e1' and (f ->> 'gps_lat')::numeric = 14.554729
            and (f ->> 'gps_accuracy_m')::numeric = 6.5 and f ->> 'gps_source' = 'device' and f ->> 'photo_ref' = 'SAF-20261023-0001'));
reset role;
update neas.approved_client_content set show_photo_locations = false where project_id = '10000000-0000-0000-0000-00000000000a';
set role service_role;
select test.setv('snap9b', neas.client_snapshot(test.v('tok9'))::text);
select test.check('locations: switching photo locations off removes coordinates from the client view',
  test.v('snap9b')::jsonb -> 'files' <> '[]'::jsonb and test.v('snap9b') not like '%gps_lat%' and test.v('snap9b') not like '%14.554729%');
select test.check('locations: client view still hides staff identities and costs',
  not (test.v('snap9') ilike '%created_by%' or test.v('snap9') ilike '%contract%' or test.v('snap9') ilike '%@neas.test%'));
reset role;
update neas.approved_client_content set show_photos = false, show_photo_locations = true where project_id = '10000000-0000-0000-0000-00000000000a';
select set_config('request.jwt.claim.sub', '', false);
