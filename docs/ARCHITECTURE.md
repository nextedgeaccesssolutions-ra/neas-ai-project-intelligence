# NEAS AI Project Intelligence — Architecture

## Modes
| Mode | When | Data | Accounts |
| --- | --- | --- | --- |
| Device | Supabase env vars empty (also the single-file web build) | Browser storage on each device; optional Google Sheet mirror | None |
| Cloud | `NEXT_PUBLIC_SUPABASE_*` set | Supabase Postgres (system of record) + offline cache/outbox per device | Supabase Auth with admin approval |

## Components
- **Next.js 14 app (Vercel)**: workspace pages, Control panel (`/admin`), sign-in flows, client portal (`/client/[code]`).
- **Server routes (`app/api/*`)**: everything that needs a secret — registration, approvals, suspensions, resets, invitations, client passcode login/snapshot/logout, Google Sheets mirror. Each route authenticates the caller, validates input, and refuses cross-site requests.
- **Supabase**: schema `neas` (isolated from any existing tables), Row Level Security on every table, private bucket `neas-project-files`, SECURITY DEFINER admin functions that check Super Admin and write the audit log.
- **Offline engine**: service worker (app shell), browser cache of the user's projects, IndexedDB outbox (`lib/offline/outbox.ts`).
- **Google Sheets**: reporting copy only, written by the server through a signed Apps Script web app (`integrations/apps-script-cloud.gs`).

## Source-of-truth policy
| Data | Source of truth | Copies |
| --- | --- | --- |
| Projects, memberships, accounts | Supabase | Google Sheet (read-only report) |
| Schedule, reports, BOQ, quotations | Supabase | Device cache, Google Sheet |
| Unsent field work | Device outbox until the server confirms | — |
| Photos/documents | Supabase Storage (private) | Device until uploaded |
| Client passcodes | Supabase (bcrypt hash only) | Never copied anywhere |

## Permission matrix (enforced by RLS and database functions)
| Capability | Super Admin | Project Manager (assigned) | Employee/Technician/Inspector (assigned) | Client (passcode) |
| --- | --- | --- | --- | --- |
| See project | All | Own projects | Own projects | One project, approved content only |
| Create/suspend/archive projects | ✓ | — | — | — |
| Approve registrations, suspend users, reset passwords, roles | ✓ | — | — | — |
| Assign team | ✓ | Add/remove employees | — | — |
| Edit schedule (activities) | ✓ | ✓ | Read | Approved Gantt/S-curve if enabled |
| File reports/photos | ✓ | ✓ | ✓ (own) | — |
| Approve/reject reports, share with client | ✓ | ✓ (or members with “can approve”) | — | — |
| BOQ, costs, quotations | ✓ | ✓ | — | — |
| Client passcodes and visibility | ✓ | — | — | — |
| Audit log | ✓ | — | — | — |

Suspended accounts, unverified e-mails, and members of suspended/archived projects fail every check.

## Offline synchronisation
1. Every local change becomes an operation `{op_id (UUID), entity, record_id, project_id, base_version, payload}` in IndexedDB. Unsent edits to one record are merged.
2. When online, operations are sent in dependency order to `neas.apply_operation`, which runs **as the user** (RLS applies).
3. The server records each `op_id`; a retry returns the stored result (no duplicates).
4. Updates carry the version they were based on. A newer server version → **Conflict**; the person chooses *Keep mine* or *Use server version*.
5. Refusals (validation, access removed, suspended) → **Sync error**, kept on the device for review, never dropped.
6. Network failures retry with exponential backoff (2 s → 5 min, jitter).
7. Photos upload to `<project_id>/<id>.jpg` (idempotent upsert) before their database row.

Offline limits: sign-in, registration, approvals, resets, report reviews, admin actions and live AI need a connection. A previously signed-in user can work offline for `NEXT_PUBLIC_OFFLINE_GRACE_HOURS`. Data cached on a lost device stays readable to whoever unlocks it until the cache is cleared; use device screen locks and “Sign out and clear this device”.

## Threat model (summary)
| Threat | Control |
| --- | --- |
| Guessing project URLs / IDs | URLs grant nothing; RLS checks membership on every row |
| Employee reading costs or other projects | RLS: BOQ/quotes managers only; membership per project |
| Self-approval / role escalation | Trigger guard on reports; profiles writable only for name/title; role changes via admin function |
| Suspended user syncing queued data | `is_active_user()` in every policy; `apply_operation` refuses; data kept for review |
| Passcode brute force | bcrypt hash, 60-bit codes, 5 failures / 15 min per address, generic errors, audit |
| Passcode leakage | Shown once, never logged, never in URLs; rotation ends sessions; recommend named accounts for accountability |
| Client seeing internal data | Server-built allowlisted snapshot; no Supabase key in the client portal |
| Secret exposure | Service key server-only (`server-only` import guard); bundle scan in the build check |
| Duplicate rows from retries | `op_id` ledger; Sheets mirror idempotency key + HMAC + timestamp |
| CSRF | Same-origin check on state-changing routes; SameSite=Strict client cookie |
