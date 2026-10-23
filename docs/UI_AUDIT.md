# NEAS Platform — UI/UX audit and stage 1–3 changes

Branch `feature/ui-shell` (from `feature/location-approval`). Stage 1 (audit), stage 2 (tokens), stage 3 (shell) and the dashboard action center are done; later stages are listed under *Next*.

## Architecture (inspected)
- Next.js 14 app router, client components, one global stylesheet `app/globals.css` with CSS custom properties (navy `#071D29`, sand `#EBC07E`, gold `#CA9332`, white, neutral greys). No component library or icon package; icons are inline SVG in `components/Shell.tsx`.
- Supabase (schema `neas`, RLS) with an offline outbox; Vercel project `neas-platform-preview`; Google Sheets through a signed Apps Script bridge.
- Roles: Super Admin (`global_role`), per-project `project_manager` / `employee`, per-user module access (`allowed_views`), clients via passcode portal `/client/[code]`.
- Routes: `/` Overview, `/projects`, `/project-management`, `/field-reports`, `/site-evidence`, `/reports`, `/google-sheets`, `/estimating`, `/quotation` (managers), `/offline-queue`, `/admin` (Super Admin), `/account`, auth pages, `/client/[code]`.

## Findings before the change
1. Flat sidebar list with no grouping; administrative and operational items not separated beyond one label.
2. No collapsed sidebar; no tooltips; fixed 236 px rail.
3. Top bar showed a fixed "NEAS / Project Intelligence" crumb, not a real breadcrumb; no user or role shown on desktop.
4. Mobile drawer had no backdrop, no Escape and no outside-click close.
5. No skip link; focus outline only on buttons and nav links.
6. Overview showed one project at a time; no portfolio counts or prioritised actions.
7. Project picker listed internal UUIDs (fixed earlier in `feature/location-approval` with search).

## Changes
- **Design tokens:** existing NEAS palette kept; focus ring (gold) extended to links, inputs and selects; 36 px minimum control height (normal buttons and inputs); reduced-motion respected.
- **Shell (`components/Shell.tsx`):** one `Main` navigation landmark with labelled groups (Dashboard, Projects, Field operations, Reports, Commercial, System, Administration); same permission filters as before (module access, manager-only commercial pages, Super Admin control panel, cloud-only offline queue). Collapsible to a 76 px icon rail with tooltips and accessible names, remembered per device. Account link stays reachable when collapsed. Breadcrumb (`Dashboard › group › page`), user chip with name and role, skip-to-content link, mobile drawer with backdrop and Escape. Labels: "Schedule & Gantt" (was Project management), "Google Sheets sync" (was setup). Routes unchanged.
- **Dashboard (`components/PortfolioSummary.tsx`):** six KPI cards and an action center computed only from loaded records of **active** projects: active/completed counts, average actual progress (schedule engine), overdue activities, reports awaiting review, open work stoppages, activities finishing within 14 days, missing required photos. Each card and action links to the page that resolves it and selects the project. No trends are shown because no history table exists to support them.

## Evidence
- `npx tsc --noEmit` clean; `npx vitest run` 105/105; `npx next build` OK.
- Browser (device mode): 5 nav groups render; KPIs show real counts (2 active, 20.0 % average, 2 overdue, 3 due soon); action center lists the overdue activities. No horizontal overflow at 360, 768, 1024 and desktop widths; title no longer truncated on phones; drawer opens, closes on Escape and backdrop; sidebar collapses to 76 px with labelled icons and expands again.
- Independent review: no permission regressions; points on landmarks, collapsed account access, KPI scope, links and control height fixed.

## Not done / next stages
- Project list filters and sort, project detail tabs, Gantt filters and grouping, photo lightbox, reports/document list redesign, form standardisation, skeleton loaders, focus trap in the mobile drawer, notification centre (no notification service exists), global search (would need permission-aware server search).
- Not tested: screen reader pass, real phones, client portal styling.

## Rollback
The live alias can be pointed back to the previous build; this branch changes UI only (no database changes).
