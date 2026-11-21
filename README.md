# NEAS AI Project Intelligence · Project Control

Two modes from one codebase:
- **Cloud mode** (Supabase configured): accounts with administrator approval, Super Admin control panel (`/admin`), project isolation enforced by Row Level Security, client passcode portal (`/client/<PROJECT-ID>`), offline-first sync with conflict handling, server-side Google Sheets mirror. See `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md`, `docs/OPERATIONS_MANUAL.md`, `.env.example`.
- **Device mode** (no Supabase env vars): device-local project management and offline workflows.

Tests: `npm test` (unit), `npm run test:db` (database security on PostgreSQL 16).

---

## Device mode (preview build)

A standalone Next.js 16 + TypeScript app for NextEdge Access Solutions. It has eight linked modules that share one active project:

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

- Device mode stores records in the browser on that device: state in localStorage, photos in IndexedDB. It works offline after the first visit, using a service worker.
- Cloud mode depends on the configured Supabase environment and policies. Verify authentication, RLS and sync behavior in a non-production environment before enabling cloud workflows.
- Do not put confidential pricing or personal information on a shared device.

## Calculations (`lib/calc.ts`, tested in `tests/calc.test.ts`)

- **Planned %**: each activity's work is spread evenly over its calendar days (start and finish inclusive), then weighted by activity weight.
- **Actual %**: the latest field report per activity on or before the date.
- **Price build-up**: direct → +OH% of direct → +contingency% of (direct+OH) → +insurance/bond/warranty % of (direct+OH+cont) → +markup% → ex-VAT → +VAT% (if exclusive). Quotation unit prices carry the markups and are rounded to the centavo, so the printed lines add up exactly to the printed total.

## Run

```bash
npm ci
npm test
npm run dev     # http://localhost:3000
npm run build
npm start
```

Database security tests require a dedicated PostgreSQL 16 test database. Never point test workflows at production.
