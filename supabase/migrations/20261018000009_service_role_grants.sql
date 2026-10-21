-- Server routes (after-login, admin actions, Sheets export) use the service role directly on
-- neas tables. The service role is server-only (never sent to browsers) and bypasses RLS by design;
-- it still needs table privileges in a custom schema. Additive and idempotent.
grant usage on schema neas to service_role;
grant select, insert, update, delete on all tables in schema neas to service_role;
grant usage, select on all sequences in schema neas to service_role;
alter default privileges in schema neas grant select, insert, update, delete on tables to service_role;
alter default privileges in schema neas grant usage, select on sequences to service_role;
