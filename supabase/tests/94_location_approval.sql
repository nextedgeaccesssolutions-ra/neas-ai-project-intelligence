-- Manual locations: request, approval by someone else, immutable recorded GPS.
reset role;
select set_config('request.jwt.claim.sub', '', false);
insert into neas.report_attachments (id, project_id, kind, storage_path, mime_type, bytes, captured_at, gps_status, photo_ref)
values ('50000000-0000-0000-0000-0000000000f2', '10000000-0000-0000-0000-0000000000d1', 'after', '10000000-0000-0000-0000-0000000000d1/old.jpg', 'image/jpeg', 1000, now() - interval '30 days', 'no_photo_gps', 'AFT-OLD');
select test.check('location: an older photo without GPS is stored as no_photo_gps', exists (select 1 from neas.report_attachments where id = '50000000-0000-0000-0000-0000000000f2' and gps_status = 'no_photo_gps' and gps_lat is null));
insert into neas.project_memberships (project_id, user_id, role) values
  ('10000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d1', 'employee') on conflict do nothing;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);
select test.expect_error('location: a photo cannot be created with a manual location',
  $$insert into neas.report_attachments (project_id, kind, storage_path, mime_type, bytes, gps_status, gps_lat, gps_lng, gps_source) values ('10000000-0000-0000-0000-0000000000d1', 'after', 'x/y.jpg', 'image/jpeg', 1, 'manual', 14.5, 121.0, 'manual')$$);
insert into neas.location_requests (id, project_id, attachment_id, lat, lng, site_ref, reason)
values ('60000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-0000000000d1', '50000000-0000-0000-0000-0000000000f2', 14.585771, 121.029367, 'Tower A, north facade', 'Camera location was off');
select test.check('location: a member can request a manual location (pending)',
  (select status = 'pending' and requested_by = '00000000-0000-0000-0000-0000000000d1' from neas.location_requests where id = '60000000-0000-0000-0000-0000000000f1'));
select test.expect_error('location: an employee cannot decide requests',
  $$select neas.decide_location_request('60000000-0000-0000-0000-0000000000f1', 'approved')$$);
select test.expect_error('location: requests cannot be edited directly',
  $$update neas.location_requests set status = 'approved' where id = '60000000-0000-0000-0000-0000000000f1'$$);
reset role;
select test.check('location: a pending request does not change the photo',
  (select gps_status = 'no_photo_gps' and gps_lat is null from neas.report_attachments where id = '50000000-0000-0000-0000-0000000000f2'));

-- the project manager cannot approve their own request
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
insert into neas.location_requests (id, project_id, attachment_id, lat, lng, reason)
values ('60000000-0000-0000-0000-0000000000f2', '10000000-0000-0000-0000-0000000000d1', '50000000-0000-0000-0000-0000000000f1', 14.5, 121.0, 'Own request');
select test.expect_error('location: nobody approves their own request',
  $$select neas.decide_location_request('60000000-0000-0000-0000-0000000000f2', 'approved')$$);
select test.expect_error('location: rejecting needs a reason',
  $$select neas.decide_location_request('60000000-0000-0000-0000-0000000000f1', 'rejected', '')$$);
select neas.decide_location_request('60000000-0000-0000-0000-0000000000f1', 'approved', 'Checked against site plan');
reset role;
select test.check('location: approval writes the coordinates as a manual location and keeps the previous status',
  (select f.gps_status = 'manual' and f.gps_source = 'manual' and f.gps_lat = 14.585771 and r.status = 'approved' and r.decided_by = '00000000-0000-0000-0000-0000000000b1' and r.prev_status = 'no_photo_gps'
   from neas.report_attachments f join neas.location_requests r on r.attachment_id = f.id where r.id = '60000000-0000-0000-0000-0000000000f1'));
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
select test.expect_error('location: a decided request cannot be decided again',
  $$select neas.decide_location_request('60000000-0000-0000-0000-0000000000f1', 'rejected', 'changed my mind')$$);
update neas.report_attachments set gps_lat = 10, gps_lng = 10, caption = 'edited' where id = '50000000-0000-0000-0000-0000000000f2';
reset role;
select test.check('location: an edit cannot move a recorded location (other fields still save)',
  (select gps_lat = 14.585771 and caption = 'edited' from neas.report_attachments where id = '50000000-0000-0000-0000-0000000000f2'));
delete from neas.project_memberships where project_id = '10000000-0000-0000-0000-0000000000d1' and user_id = '00000000-0000-0000-0000-0000000000d1';
select set_config('request.jwt.claim.sub', '', false);
