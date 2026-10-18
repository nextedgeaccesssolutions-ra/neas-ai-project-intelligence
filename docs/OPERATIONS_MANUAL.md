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
