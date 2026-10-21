# NEAS Project Control — user and administrator manual

## Everyone
- **Sign in**: e-mail + password. Forgot it? Use *Forgot password?* — a single-use link arrives by e-mail.
- **Status pill (top right)**: *Online — synchronized*, *Offline — working locally*, *Pending sync (n)*, *Sync error*, *Conflict detected*. Click it to open the Offline queue.
- **Working offline**: keep using the app; reports, progress and photos are saved on the device and sent automatically when you reconnect. Do not clear browser data while items are pending.
- **Conflict**: someone changed the same record. Choose *Keep mine* (send your version on top) or *Use server version*.
- **Leaving a shared device**: Account → *Sign out and clear this device*.

## Employees / technicians / inspectors
1. Request an account (`/register`) → verify e-mail → wait for approval → set your password from the e-mail link.
2. Field reports: choose activity, date, % complete, notes → *Save field report*. Add photos in Site evidence.
3. You can edit your report until a manager reviews it.

## Project managers
- Project management: activities, dates, weights, latest actual progress.
- Field reports: *Approve* / *Reject*; tick *client* to show an approved report in the client portal.
- Estimating & BOQ and Quotation: confidential; quotations follow Draft → Submitted → Approved → Issued.

## Super Admin — Control panel (`/admin`)
- **Overview**: counts, pending approvals, client links, sync problems, portfolio planned vs earned value (SPI).
- **Projects**: create (ID like PRJ-2026-001), suspend, archive, assign team, copy team/client URLs.
- **Pending approvals**: confirm the person works with NEAS, then approve (they receive a password-setup link) or reject.
- **Active users**: suspend (immediate), reactivate, send password reset, grant/remove Super Admin.
- **Invitations**: pre-approve someone for a project; they set their own password.
- **Client viewer access**: turn the portal on, generate or rotate a passcode (shown once — share it separately from the link), choose what clients see, review client sign-ins.
- **Synchronization**: field-device conflicts/errors and the Google Sheet update log; *Update Google Sheet now*.
- **Audit log**: every administrative and security event.

## Clients
Open `https://<app>/client/<PROJECT-ID>`, enter the passcode, view approved progress, schedule, reports and photos. Read-only. Sessions expire; ask NEAS for a new passcode if it stops working.

## User directory (Control panel → User directory)
Search by name, e-mail, job title or project ID; filter by status, role and project. Each row shows
verified e-mail, account status, approval, global role, projects with project role, last sign-in,
created date, password setup and password reset status. **Export** saves the filtered list as Excel,
Word, PDF or image.

**Manage** on a row:
- Approve / Reject (pending registrations), Suspend / Activate.
- Send password reset — a single-use link goes to the user; you never see a password. The Reset
  column shows "not used yet" until the user sets a new password, then "Completed".
- Sign out everywhere — ends all sessions immediately: refresh tokens are deleted and access tokens
  already issued stop working at the database. Suspending an account does this automatically.
- Make / Remove Super Admin (never your own role).
- Project access — add to a project, change Employee / Project manager, allow report approval, remove.
- Sign-in and administration history for that person.

Suspended users, or users whose sessions were revoked, are refused by the database itself. Changes
they queued offline are refused when the device reconnects and stay on the device marked
"Sync error" for review; they are never applied.

## Sign-up and sign-in rules
- The owner account **info.nextedgeaccesssolutions@gmail.com** becomes the first Super Admin as soon as it
  registers and verifies its e-mail (only while no Super Admin exists).
- Everyone else: register → verify e-mail → **wait for the administrator's approval**. The administrator
  gets an e-mail for each new request (through the Apps Script bridge; script property `ADMIN_EMAIL`).
- Sign-in is refused until the account is approved and active. The person sees "waiting for approval",
  "suspended" or "not approved"; every refused sign-in is recorded in the audit log.

## What each employee can see (module access)
Control panel → User directory → Manage → **Modules this person can use**. Tick the modules (Overview,
Estimating & BOQ, Quotation, Project management, Field reports, Project register, Site evidence, Google
Sheets setup, Offline queue). Unticked modules disappear from their menu and show "Not available" if
opened by link. The database also enforces it: without Estimating/Quotation they cannot read or change
BOQ, cost settings or quotations; without Project management they cannot change schedules; without Field
reports/Project management they cannot submit reports; without Site evidence/Field reports they cannot
upload photos. Project membership still decides *which projects* they see.

## What each client can see
Control panel → Client viewer access → choose project → tick what the client portal shows (overview,
milestones, progress %, Gantt, S-curve, approved reports, approved photos, approved documents, completion
status). Everything is off by default except the overview; costing, quotations and staff details are never
shown. Only reports and photos you mark client-visible appear.

## One-time codes (no e-mail needed)
**Employees**
- New person: Control panel → Invitations → *Add a person with a one-time code* (name, e-mail, project,
  role, how long the code is valid). The account is created approved and a code like `K7QM-4XTR-9PZH`
  appears once.
- Existing or pending person: User directory → Manage → *Give one-time sign-in code* (or *Approve and give
  one-time code*). A new code cancels any earlier unused one.
- Hand the code over in person, by phone or a separate message. The person opens `/activate`, enters
  e-mail + code and chooses their own password. The code then stops working. You never see the password.
- Wrong codes: 5 tries per address or e-mail, then 15 minutes locked. Suspended accounts cannot use codes.

**Clients**
- Client viewer access → Type: *One-time (first sign-in only)* or *Reusable until it expires*.
- *Stay signed in for* 8 hours … 30 days. A one-time passcode opens the portal on one device for that long.

## Working offline and online
- Employees: after the first online sign-in (activation or password) the app keeps working offline on that
  device — schedules, reports, photos and edits are saved locally and sent automatically when the
  connection returns. Offline use lasts up to the grace period (default 72 hours, `NEXT_PUBLIC_OFFLINE_GRACE_HOURS`);
  after that the person must go online once to confirm their account is still active.
- Clients: the portal keeps an offline copy of the approved information from the last online visit and shows
  when it was saved. Photo files need a connection (their links expire for privacy).
- Needs a connection: activation with a code, first sign-in, approvals, password resets, module or access
  changes made by the administrator.
