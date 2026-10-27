-- Editable report cover page.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);
select test.expect_error('cover: someone outside the project cannot edit its cover', $$select neas.save_report_cover_values('10000000-0000-0000-0000-000000000098', '{"Client": "X"}')$$);
select test.expect_error('cover: staff cannot change the cover layout', $$select neas.save_report_cover_layout('10000000-0000-0000-0000-000000000098', '{"title": "X"}')$$);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select test.expect_error('cover: lines must be short text', $$select neas.save_report_cover_values('10000000-0000-0000-0000-000000000098', '{"Client": 5}')$$);
select neas.save_report_cover_values('10000000-0000-0000-0000-000000000098', '{"Client": "Jangho Curtainwall Phils."}');
select neas.save_report_cover_layout('10000000-0000-0000-0000-000000000098', '{"title": "Monthly Progress Report", "rows": [{"key": "Site", "show": false}]}');
select test.check('cover: a Super Admin saves values and layout', (select cover_values ->> 'Client' = 'Jangho Curtainwall Phils.' and layout ->> 'title' = 'Monthly Progress Report' from neas.report_cover_settings where project_id = '10000000-0000-0000-0000-000000000098'));
select test.expect_error('cover: the table cannot be written directly', $$insert into neas.report_cover_settings (project_id) values ('10000000-0000-0000-0000-000000000099')$$);
reset role;
