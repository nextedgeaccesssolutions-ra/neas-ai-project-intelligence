# Deployment, rollback and backup

## 0. Connecting to the existing NEAS app (neas-ai-project-intelligence.vercel.app)
The live app (repo `nextedgeaccesssolutions-ra/neas-ai-project-intelligence`, branch `main`) is a static
HTML app on Supabase project `smlxekhbaefbvdbfxpew`, using tables in `public`. This platform lives in the
same repository on branch **`feature/platform-upgrade`**; the old files are kept under `legacy/`.
It can share the same Supabase project safely:
- Every new object is in the `neas` schema and the `neas-project-files` bucket. No `public` table,
  policy, function, trigger, bucket or user is altered or dropped. Both apps can run side by side.
- One extra trigger is added on `auth.users` (`neas_on_auth_user_created`). It only writes to `neas.*`
  and runs next to the old `neas_handle_new_user` trigger; new sign-ups in either app also appear in
  *Pending approvals* here.
- Existing records are copied, not moved: `select neas.import_legacy_public();` (database owner only,
  read-only on `public.*`, safe to re-run). Admins become Super Admins, working roles become active
  staff, unreviewed `viewer` sign-ups wait for approval. Evidence photos stay in the old bucket.

Steps (take a backup first: Supabase → Database → Backups, or `pg_dump`):
1. Push branch `feature/platform-upgrade`. Vercel builds a **preview** of it automatically; production
   (`main`) is untouched. `vercel.json` selects the Next.js build for this branch only.
2. Supabase SQL editor: run migrations `20261018000001` … `20261018000008` in order, then
   `select neas.import_legacy_public();` and check the counts it returns.
3. Supabase → Settings → API → *Exposed schemas*: add `neas`.
4. Supabase → Auth → URL configuration: add `<preview URL>/auth/callback` to redirect URLs.
5. Vercel → Settings → Environment Variables, scope **Preview** (branch `feature/platform-upgrade`):
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the publishable key),
   `SUPABASE_SERVICE_ROLE_KEY` (secret), `CLIENT_PORTAL_SECRET` (optional; derived from the service-role key when unset), `CRON_SECRET`, and for Sheets
   `SHEETS_WEBHOOK_URL` / `SHEETS_WEBHOOK_SECRET`. Redeploy the preview.
   Without the Supabase variables the preview runs in device mode (data on each device).
6. Run the acceptance checklist (section 3) on the preview with two real accounts.
7. Production, only after written approval: merge `feature/platform-upgrade` into `main`, copy the
   variables to the Production scope, set the Auth *Site URL* to the production domain.
   Rollback = promote the previous production deployment in Vercel (instant); data is unaffected.

Cron note: Vercel Hobby allows one cron run per day, so `vercel.json` mirrors to Google Sheets daily
(02:00 Manila). On Pro, change the schedule to `*/15 * * * *`. Admins can sync any time from
*Control panel → Synchronization*.

## 1. Preview first (never straight to production)
1. Create a **separate** Supabase project (or a Supabase branch) for preview.
2. Apply migrations in order from `supabase/migrations/` (Supabase SQL editor or `supabase db push`). They only create objects in the new `neas` schema and the `neas-project-files` bucket; they never drop or rewrite existing tables.
3. Supabase → Settings → API → *Exposed schemas*: add `neas`.
4. Supabase → Auth: enable e-mail confirmations; set Site URL to the preview URL; add `<URL>/auth/callback` to redirect URLs; turn on leaked-password protection; consider MFA for admins.
5. First Super Admin: automatic. When info.nextedgeaccesssolutions@gmail.com registers and verifies the e-mail while no Super Admin exists, it becomes Super Admin (setting `bootstrap_admin_email` in `neas.app_settings`). Everyone after that needs that admin's approval. Manual fallback:
   ```sql
   update neas.profiles set global_role = 'super_admin', status = 'active', approved_at = now()
   where lower(email) = 'info.nextedgeaccesssolutions@gmail.com';
   ```
6. Vercel: new project from this repository, branch `feature/platform-upgrade`, environment variables from `.env.example` (preview scope).
7. Google Sheets: paste `integrations/apps-script-cloud.gs` into the sheet's Apps Script, set `NEAS_HMAC_SECRET`, deploy as web app, put its URL and the same secret in Vercel.
8. Run the acceptance checklist below on the preview. Only then repeat steps 2–7 for production with explicit approval.

## 2. Checks before every release
```bash
npm ci
npm test                 # unit tests (calculations, sync engine, validation, client view)
npm run test:db          # 125 database security tests on a throwaway PostgreSQL 16
npx tsc --noEmit
npm run build
grep -r "SUPABASE_SERVICE_ROLE_KEY\|$SUPABASE_SERVICE_ROLE_KEY" .next/static && echo "SECRET LEAK" || echo "bundle clean"
```

## 3. Acceptance checklist on the preview (with two real accounts)
- Unverified / unapproved accounts cannot open any project.
- Employee on project A cannot open project B by URL; manager cannot approve B's reports.
- Suspend a user → their next request fails; their queued offline report shows *Sync error*.
- Offline: file a report and a photo in airplane mode, refresh, reopen → still there; reconnect → synced once.
- Edit the same activity on two devices → second shows *Conflict detected*.
- Client: valid passcode works; wrong passcode 5× → locked 15 minutes; rotation ends old sessions; no costs/staff visible.
- Control panel → Synchronization → *Update Google Sheet now* → sheet tabs refresh; running again reports “already up to date”.

## 4. Rollback
- **App**: Vercel → Deployments → previous deployment → *Promote to production* (instant).
- **Database**: migrations are additive. To disable the platform without data loss, revoke API exposure of the `neas` schema. A full removal script is intentionally not provided; dropping the schema deletes data and needs a fresh backup and written approval.
- **Sheets**: disable the cron (remove `crons` from `vercel.json` or unset `CRON_SECRET`).

## 5. Backup and restore
- Supabase daily backups (Pro plan) + point-in-time recovery where available.
- Weekly logical export: `pg_dump --schema=neas --no-owner > neas-YYYYMMDD.sql`, stored outside Supabase.
- Storage: periodic copy of bucket `neas-project-files`.
- Restore drill quarterly into a scratch project; run `npm run test:db` style checks against it.
