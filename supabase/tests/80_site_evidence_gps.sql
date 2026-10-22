-- Site evidence GPS metadata, photo types and pairing.
reset role;
select set_config('request.jwt.claim.sub', '', false);
select set_config('request.jwt.claims', '', false);

insert into neas.report_attachments (id, project_id, kind, storage_path, mime_type, bytes, captured_at, gps_status, gps_lat, gps_lng, gps_accuracy_m, work_area, location_detail, photo_ref)
values ('50000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-00000000000a', 'safety', '10000000-0000-0000-0000-00000000000a/gps1.jpg', 'image/jpeg', 1000,
        now(), 'captured', 14.554729, 121.024445, 6.5, 'North facade', 'Tower 1 · L12 · Grid C', 'SAF-20261023-0001');
select test.check('evidence: safety photos with device GPS and work area are stored',
  (select gps_status = 'captured' and gps_accuracy_m = 6.5 and work_area = 'North facade' from neas.report_attachments where id = '50000000-0000-0000-0000-0000000000e1'));

insert into neas.report_attachments (id, project_id, kind, storage_path, mime_type, bytes, gps_status)
values ('50000000-0000-0000-0000-0000000000e2', '10000000-0000-0000-0000-00000000000a', 'inspection', '10000000-0000-0000-0000-00000000000a/gps2.jpg', 'image/jpeg', 1000, 'unavailable');
select test.check('evidence: a photo without GPS is still accepted (GPS unavailable)',
  exists (select 1 from neas.report_attachments where id = '50000000-0000-0000-0000-0000000000e2' and gps_lat is null));

select test.expect_error('evidence: coordinates out of range are refused',
  $$insert into neas.report_attachments (project_id, kind, storage_path, mime_type, bytes, gps_status, gps_lat, gps_lng)
    values ('10000000-0000-0000-0000-00000000000a', 'before', '10000000-0000-0000-0000-00000000000a/bad.jpg', 'image/jpeg', 1, 'captured', 200, 10)$$);
select test.expect_error('evidence: "captured" GPS without coordinates is refused',
  $$insert into neas.report_attachments (project_id, kind, storage_path, mime_type, bytes, gps_status)
    values ('10000000-0000-0000-0000-00000000000a', 'before', '10000000-0000-0000-0000-00000000000a/bad2.jpg', 'image/jpeg', 1, 'captured')$$);
select test.expect_error('evidence: coordinates without a GPS status are refused',
  $$insert into neas.report_attachments (project_id, kind, storage_path, mime_type, bytes, gps_lat, gps_lng)
    values ('10000000-0000-0000-0000-00000000000a', 'before', '10000000-0000-0000-0000-00000000000a/bad3.jpg', 'image/jpeg', 1, 14.5, 121.0)$$);
select test.expect_error('evidence: unknown photo types are refused',
  $$insert into neas.report_attachments (project_id, kind, storage_path, mime_type, bytes)
    values ('10000000-0000-0000-0000-00000000000a', 'selfie', '10000000-0000-0000-0000-00000000000a/bad4.jpg', 'image/jpeg', 1)$$);

update neas.report_attachments set pair_id = '60000000-0000-0000-0000-0000000000e1'
where id in ('50000000-0000-0000-0000-0000000000e1', '50000000-0000-0000-0000-0000000000e2');
select test.check('evidence: before/after photos can share a pair id',
  (select count(*) = 2 from neas.report_attachments where pair_id = '60000000-0000-0000-0000-0000000000e1'));

-- A geotagged photo syncs through the normal offline path.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select test.setv('gps_op', neas.apply_operation(jsonb_build_object(
  'op_id', '70000000-0000-0000-0000-0000000000e1', 'entity', 'report_attachments', 'op', 'upsert',
  'record_id', '50000000-0000-0000-0000-0000000000e3', 'project_id', '10000000-0000-0000-0000-00000000000a',
  'payload', jsonb_build_object('kind', 'before', 'storage_path', '10000000-0000-0000-0000-00000000000a/gps3.jpg', 'mime_type', 'image/jpeg', 'bytes', 1200,
    'captured_at', '2026-10-23T02:00:00Z', 'gps_status', 'captured', 'gps_lat', 14.5, 'gps_lng', 121.0, 'gps_accuracy_m', 24, 'work_area', 'Podium', 'photo_ref', 'BEF-20261023-0003')))::text);
select test.check('evidence: GPS metadata syncs through apply_operation',
  test.v('gps_op')::jsonb ->> 'status' = 'applied' and (test.v('gps_op')::jsonb -> 'record' ->> 'gps_accuracy_m')::numeric = 24, test.v('gps_op'));
select test.setv('gps_op2', neas.apply_operation(jsonb_build_object(
  'op_id', '70000000-0000-0000-0000-0000000000e1', 'entity', 'report_attachments', 'op', 'upsert',
  'record_id', '50000000-0000-0000-0000-0000000000e3', 'project_id', '10000000-0000-0000-0000-00000000000a', 'payload', '{}'::jsonb))::text);
select test.check('evidence: repeating the same sync does not create a duplicate',
  (test.v('gps_op2')::jsonb ->> 'duplicate')::boolean
  and (select count(*) = 1 from neas.report_attachments where id = '50000000-0000-0000-0000-0000000000e3'));
reset role;
select set_config('request.jwt.claim.sub', '', false);
