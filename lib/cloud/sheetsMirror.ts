// Mirrors Supabase (system of record) into the NEAS Google Sheet through the signed Apps Script
// bridge. Each mirror rewrites only the app-owned tabs; other tabs in the spreadsheet are untouched.
import { createHmac } from 'node:crypto';
import { HttpError, sha256, supabaseService } from './server';
import { bundleToState, withProjectCodes, type DbBundle } from './mapping';
import { emptyState } from '../seed';
import { rowsToGrid, safeCell, stateToRows, TAB_NAMES, type Cell } from '../sheetSchema';
import { todayIn } from './clientView';
import { calendarOf, scopeMetrics } from '../schedule';
import { gpsSourceShort } from '../coverPhotos';
import { accuracyStatus, mapUrl } from '../geo';

// Mirrors Supabase (system of record) into the NEAS Google Sheet through the signed Apps Script
// bridge. Runs on a schedule (Vercel Cron) and on demand from the control panel.
export async function mirror(): Promise<{ status: 'ok' | 'skipped'; rows: number }> {
  const url = process.env.SHEETS_WEBHOOK_URL;
  const secret = process.env.SHEETS_WEBHOOK_SECRET;
  if (!url || !secret) throw new HttpError(503, 'Google Sheets bridge is not configured (SHEETS_WEBHOOK_URL / SHEETS_WEBHOOK_SECRET).');
  const svc = supabaseService();
  const q = async (t: string) => {
    const { data, error } = await svc.from(t).select('*');
    if (error) throw new Error(`${t}: ${error.message}`);
    return data ?? [];
  };
  const [projects, activities, reports, boq, costs, quotes, attachments, profiles, members] = await Promise.all(
    ['projects', 'activities', 'project_reports', 'boq_lines', 'cost_settings', 'quotations', 'report_attachments', 'profiles', 'project_memberships'].map(q),
  );
  const bundle = { projects, activities, reports, boq, costs, quotes, attachments } as unknown as DbBundle;
  const state = withProjectCodes(bundleToState(bundle, emptyState()));
  const rows = stateToRows(state, todayIn(process.env.APP_TIMEZONE || 'Asia/Manila'));
  const tabs: Record<string, Cell[][]> = {};
  for (const t of TAB_NAMES) tabs[t] = rowsToGrid(t, rows[t]);
  const code = new Map((projects as { id: string; code: string }[]).map((p) => [p.id, p.code]));
  const person = new Map((profiles as { id: string; full_name: string; email: string }[]).map((p) => [p.id, p.full_name || p.email]));
  // staff directory for internal reporting: no passwords, tokens or passcodes exist in these rows
  tabs.Users = [['Name', 'E-mail', 'Status', 'Role', 'E-mail verified', 'Last sign-in', 'Created'], ...(profiles as Record<string, string | null>[]).map((p) => [p.full_name ?? '', p.email ?? '', p.status ?? '', p.global_role === 'super_admin' ? 'Super Admin' : 'Staff', p.email_verified_at ? 'yes' : 'no', p.last_login_at ?? '', p.created_at ?? ''])];
  tabs.Memberships = [['Project', 'Person', 'Role', 'Can approve reports'], ...(members as { project_id: string; user_id: string; role: string; can_approve_reports: boolean }[]).map((m) => [code.get(m.project_id) ?? m.project_id, person.get(m.user_id) ?? m.user_id, m.role, m.can_approve_reports ? 'yes' : 'no'])];
  tabs.Report_Review = [['Report ID', 'Project', 'Report date', 'Status', 'Client visible', 'Reviewed at'], ...(reports as Record<string, unknown>[]).filter((r) => !r.deleted_at).map((r) => [String(r.id), code.get(String(r.project_id)) ?? '', String(r.report_date), String(r.status), r.client_visible ? 'yes' : 'no', String(r.reviewed_at ?? '')])];

  const [reportsLog, stopRows, calRows, locRequests] = await Promise.all(['project_report_exports', 'activity_stops', 'project_calendars', 'location_requests'].map((t) => q(t).catch(() => [])));
  const { data: syncLog } = await svc.from('integration_sync_log').select('*').order('at', { ascending: false }).limit(200);
  const full = bundleToState({ ...bundle, stops: stopRows, calendars: calRows } as unknown as DbBundle, emptyState());
  addProjectTabs(tabs, full, { projects, reportsLog, syncLog: syncLog ?? [], attachments, profiles, members, locRequests } as never, todayIn(process.env.APP_TIMEZONE || 'Asia/Manila'));
  // the sheet stores text as typed: neutralise anything that would run as a formula, except our own map links
  for (const t of Object.keys(tabs)) tabs[t] = tabs[t].map((row) => row.map(safeCell));
  const payload = JSON.stringify({ tabs });
  const key = sha256(payload);
  const { data: last } = await svc.from('integration_sync_log').select('idempotency_key').eq('status', 'ok').order('at', { ascending: false }).limit(1).maybeSingle();
  if (last?.idempotency_key === key) {
    await svc.from('integration_sync_log').insert({ status: 'skipped', rows_written: 0, idempotency_key: key });
    return { status: 'skipped', rows: 0 };
  }
  const ts = Date.now();
  const sig = createHmac('sha256', secret).update(`${ts}.${payload}`).digest('hex');
  let lastErr = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ts, sig, key, payload }), redirect: 'follow' });
      const j = (await r.json().catch(() => null)) as { ok?: boolean; rows?: number; error?: string } | null;
      if (r.ok && j?.ok) {
        await svc.from('integration_sync_log').insert({ status: 'ok', rows_written: j.rows ?? 0, idempotency_key: key });
        return { status: 'ok', rows: j.rows ?? 0 };
      }
      lastErr = j?.error ?? `HTTP ${r.status}`;
      if (r.status < 500 && j?.error !== 'stale') break; // permanent: bad signature / config
    } catch (e) {
      lastErr = (e as Error).message;
    }
    await new Promise((res) => setTimeout(res, 1000 * 2 ** attempt));
  }
  await svc.from('integration_sync_log').insert({ status: 'error', rows_written: 0, idempotency_key: key, error: lastErr.slice(0, 500) });
  throw new HttpError(502, `Google Sheet update failed: ${lastErr}`);
}


type R = Record<string, unknown>;
const v = (x: unknown): Cell => (x == null ? '' : typeof x === 'number' ? x : String(x));

/** Project register, report log, Gantt progress, evidence with GPS and the sync log (stable IDs in column A). */
function addProjectTabs(tabs: Record<string, Cell[][]>, state: ReturnType<typeof bundleToState>, raw: { projects: R[]; reportsLog: R[]; syncLog: R[]; attachments: R[]; profiles: R[]; members: R[]; locRequests: R[] }, today: string) {
  const code = new Map(raw.projects.map((p) => [String(p.id), String(p.code)]));
  const person = new Map(raw.profiles.map((p) => [String(p.id), String(p.full_name || p.email || '')]));
  const now = new Date().toISOString();
  const pm = (pid: string) => raw.members.filter((m) => m.project_id === pid && m.role === 'project_manager').map((m) => person.get(String(m.user_id)) ?? '').filter(Boolean).join(', ');
  tabs.Project_Register = [['Project ID', 'Project title', 'Client', 'Site', 'Scope of work', 'Project manager', 'Start date', 'Planned completion', 'Actual completion', 'Status', 'Last updated'],
    ...raw.projects.map((p) => {
      const acts = state.activities.filter((a) => a.projectId === p.id);
      const done = acts.length && acts.every((a) => a.actualFinish) ? acts.map((a) => a.actualFinish as string).sort().pop() : '';
      return [v(p.code), v(p.name), v(p.client_name), v(p.site), acts.map((a) => a.name).join('; '), pm(String(p.id)), v(p.start_date), v(p.end_date), v(done), v(p.status), v(p.updated_at ?? p.created_at)];
    })];
  tabs.Project_Reports = [['Report ID', 'Project ID', 'Project title', 'Reporting period', 'Generated at', 'Generated by', 'Actual progress (%)', 'Planned progress (%)', 'Variance (pp)', 'Schedule status', 'Approval status', 'Report reference', 'Last synchronized'],
    ...raw.reportsLog.map((r) => {
      const p = raw.projects.find((x) => x.id === r.project_id);
      const a = r.actual_pct == null ? null : Number(r.actual_pct), pl = r.planned_pct == null ? null : Number(r.planned_pct);
      return [v(r.id), v(p?.code), v(p?.name), `${v(r.period_from)} – ${v(r.period_to)}`, v(r.generated_at), person.get(String(r.generated_by)) ?? '', a ?? '', pl ?? '', a == null || pl == null ? '' : Math.round((a - pl) * 10) / 10, v(r.schedule_status), v(r.approval_status), v(r.report_ref), now];
    })];
  tabs.Gantt_Progress = [['Project ID', 'Task ID', 'Task', 'Baseline start', 'Baseline finish', 'Planned start', 'Planned finish', 'Actual start', 'Actual finish', 'Planned duration (wd)', 'Actual working days', 'Planned (%)', 'Actual (%)', 'Variance (pp)', 'Status', 'Delay reason', 'Last updated'],
    ...state.activities.map((a) => {
      const m = scopeMetrics(a, state.reports.filter((r) => r.activityId === a.id), today, calendarOf(state.calendars?.[a.projectId] ?? null), (state.stops ?? []).filter((s) => s.activityId === a.id));
      return [code.get(a.projectId) ?? a.projectId, a.id, a.name, v(a.baselineStart), v(a.baselineEnd), a.start, a.end, v(a.actualStart), v(a.actualFinish), m.currentDuration, m.actualDays ?? '', Math.round(m.plannedPct * 10) / 10, Math.round(m.actualPct * 10) / 10, Math.round(m.variancePts * 10) / 10, m.status, a.delayReason ?? '', now];
    })];
  tabs.Site_Evidence_GPS = [['Photo ID', 'Project ID', 'Project name', 'Photo ref', 'Category', 'Caption / site reference', 'Latitude', 'Longitude', 'Accuracy (m)', 'Accuracy status', 'GPS source', 'Location status',
    'Captured at', 'Location acquired at', 'Uploaded at', 'Manual request', 'Approved by', 'Approved at', 'Google Maps URL', 'Map link', 'On report cover', 'Client approved', 'Last synchronized'],
    ...raw.attachments.filter((f) => !f.deleted_at).map((f) => {
      const lat = f.gps_lat == null ? null : Number(f.gps_lat), lng = f.gps_lng == null ? null : Number(f.gps_lng);
      const url = mapUrl(lat, lng);
      const acc = f.gps_accuracy_m == null ? null : Number(f.gps_accuracy_m);
      const req = raw.locRequests.filter((r) => r.attachment_id === f.id).sort((a, b) => String(b.requested_at).localeCompare(String(a.requested_at)))[0];
      const approved = raw.locRequests.filter((r) => r.attachment_id === f.id && r.status === 'approved').sort((a, b) => String(b.decided_at).localeCompare(String(a.decided_at)))[0];
      const p = raw.projects.find((x) => x.id === f.project_id);
      return [v(f.id), code.get(String(f.project_id)) ?? '', v(p?.name), v(f.photo_ref), v(f.cover_category || f.kind), [f.caption, f.work_area, f.location_detail].filter(Boolean).join(' · '),
        url ? lat! : '', url ? lng! : '', acc ?? '', accuracyStatus(acc, !!url), gpsSourceShort((f.gps_source as never) ?? null, String(f.gps_status ?? ''), !!url), v(f.gps_status),
        v(f.captured_at), v(f.gps_captured_at), v(f.created_at), req ? String(req.status) : '', approved ? person.get(String(approved.decided_by)) ?? '' : '', approved ? v(approved.decided_at) : '',
        url ?? '', url ? `=HYPERLINK("${url}","VIEW LOCATION ON MAP")` : '', f.is_cover ? 'yes' : 'no', f.client_visible ? 'yes' : 'no', now];
    })];
  tabs.Sync_Log = [['Sync event', 'Time', 'Target', 'Status', 'Rows written', 'Error'],
    ...raw.syncLog.map((s) => [v(s.id), v(s.at), v(s.target), v(s.status), v(s.rows_written), v(s.error)])];
}

