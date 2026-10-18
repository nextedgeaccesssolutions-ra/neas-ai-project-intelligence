# NEAS AI Project Intelligence · Project Control

Two modes from one codebase:
- **Cloud mode** (Supabase configured): accounts with administrator approval, Super Admin control panel (`/admin`), project isolation enforced by Row Level Security, client passcode portal (`/client/<PROJECT-ID>`), offline-first sync with conflict handling, server-side Google Sheets mirror. See `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md`, `docs/OPERATIONS_MANUAL.md`, `.env.example`.
- **Device mode** (no Supabase env vars): everything below, stored on the device.

Tests: `npm test` (unit), `npm run test:db` (database security on PostgreSQL 16).

---

## Device mode (preview build)

A standalone Next.js 14 + TypeScript app for NextEdge Access Solutions. It has eight linked modules that share one active project:

| Module | Route | What works |
| --- | --- | --- |
| Overview | `/` | KPIs, S-curve, Gantt and activity table, with a status-date picker |
| Estimating & BOQ | `/estimating` | BOQ lines plus separate overhead, contingency, insurance, bonds, warranty, markup and VAT; CSV export |
| Quotation preview | `/quotation` | Client-facing prices, Draft → Submitted → Approved → Issued; print/PDF |
| Project management | `/project-management` | Activities, dates and weights, with a check that weights total 100% |
| Field reports | `/field-reports` | Cumulative % per activity, with notes |
| Project register | `/projects` | Create, edit and delete projects; portfolio progress |
| Site evidence | `/site-evidence` | Before/during/after photos, compressed and stored in IndexedDB |
| Google Sheets setup | `/google-sheets` | Copy/CSV export per tab, JSON backup and restore |

## Data and limits

- Every record is stored **in the browser on this device**: state in localStorage, photos in IndexedDB. It works offline after the first visit, using a service worker.
- There is **no sign-in, no cloud sync and no role enforcement** yet. Approvals are recorded on the device but not enforced. Don't put confidential pricing on a shared device.
- Supabase Auth/RLS, the server-side sync queue and Sheets sync belong to later slices, as set out in the Phase 1 plan.

## Calculations (`lib/calc.ts`, tested in `tests/calc.test.ts`)

- **Planned %**: each activity's work is spread evenly over its calendar days (start and finish inclusive), then weighted by activity weight. For example, NEAS-Q-2026-001 is 12.5% planned on 16 Oct 2026.
- **Actual %**: the latest field report per activity on or before the date.
- **Price build-up**: direct → +OH% of direct → +contingency% of (direct+OH) → +insurance/bond/warranty % of (direct+OH+cont) → +markup% → ex-VAT → +VAT% (if exclusive). Quotation unit prices carry the markups and are rounded to the centavo, so the printed lines add up exactly to the printed total.

## Run

```bash
npm install
npm test        # unit tests
npm run dev     # http://localhost:3000
npm run build && npm start
```
