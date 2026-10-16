# NEAS AI Project Intelligence — production rollout

## Included
- `index.html`: authenticated web app for project register, schedule/Gantt, weighted planned-vs-actual S-curve, field reports, private evidence, BOQ/estimate records, and quotation preview.
- `supabase/migrations/202610160001_neas_project_intelligence_core.sql`: project data model and RLS policies.
- `supabase/migrations/202610160002_neas_private_project_evidence.sql`: private evidence storage bucket and policies.
- `src/NEAS_Google_Sheets_Backend.gs`: optional server-only Apps Script bridge (not yet connected to the app).

## Supabase project
URL: `https://smlxekhbaefbvdbfxpew.supabase.co`
The frontend uses the public publishable key only. Never put a Supabase secret/service-role key or Google Sheets API token in frontend code.

The database migrations were applied directly to the target project and the tables were verified with RLS enabled. The SQL copies in `supabase/migrations` are for source control/reproducibility. If running on a fresh project, apply the migrations in order.

## First administrator bootstrap
New signups are intentionally assigned `viewer`. Do not let users choose their own role in the browser.
After the first trusted company account signs up and the email is confirmed, use Supabase SQL Editor as the project owner to promote only that verified account:
```sql
update public.user_roles ur
set role = 'admin', active = true
from auth.users u
where ur.user_id = u.id
  and lower(u.email) = lower('REPLACE_WITH_VERIFIED_ADMIN_EMAIL');
```
Verify that exactly one row was updated. Keep the email literal scoped to the verified account. Assign other users least-privilege roles only after review.

## App behavior
- All operational pages require an authenticated Supabase session.
- Database tables have RLS policies; browser role selectors do not grant privileges.
- Project creation requires global role `admin` or `project_manager`; BOQ/quotation creation requires `admin`, `estimator`, or `project_manager`.
- Project managers can manage projects only when membership allows it. Admins can access all projects.
- Evidence images use the private `neas-project-evidence` bucket with signed URLs.
- Google Sheets is explicitly shown as not connected until the Apps Script web app is deployed and a server-side Vercel integration is implemented.
- Quotation preview is a saved-record preview/print. Email delivery, electronic signature, and approval workflow are not implemented.

## Deployment
A Vercel preview deployment was created from GitHub main for validation. Do not assign the production alias until the preview is READY and login, project creation, activity creation, field reports, evidence upload, RLS and mobile layout have been verified with a real authorized account.
