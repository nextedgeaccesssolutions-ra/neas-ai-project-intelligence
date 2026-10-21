-- Migration 8 added max_uses / use_count to client_access_credentials, but signed-in users only
-- have column-level SELECT on that table (the passcode hash stays hidden). Allow the two new
-- non-secret columns so the Control panel can show one-time vs reusable passcodes.
-- RLS still limits rows to Super Admins (policy client_creds_admin). Additive and idempotent.
grant select (max_uses, use_count) on neas.client_access_credentials to authenticated;
