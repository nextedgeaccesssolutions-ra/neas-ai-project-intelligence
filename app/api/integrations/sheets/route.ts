import { createHmac, timingSafeEqual } from 'node:crypto';
import { handle, HttpError, requireSuperAdmin, sha256, supabaseService, assertSameOrigin } from '@/lib/cloud/server';
import { bundleToState, withProjectCodes, type DbBundle } from '@/lib/cloud/mapping';
import { emptyState } from '@/lib/seed';
import { rowsToGrid, stateToRows, TAB_NAMES, type Cell } from '@/lib/sheetSchema';
import { todayIn } from '@/lib/cloud/clientView';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Mirrors Supabase (system of record) into the NEAS Google Sheet through the signed Apps Script
// bridge. Runs on a schedule (Vercel Cron) and on demand from the control panel.
async function mirror(): Promise<{ status: 'ok' | 'skipped'; rows: number }> {
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

const bearerOk = (req: Request) => {
  const want = process.env.CRON_SECRET;
  const got = (req.headers.get('authorization') ?? '').replace(/^Bearer /, '');
  if (!want || !got || want.length !== got.length) return false;
  return timingSafeEqual(Buffer.from(want), Buffer.from(got));
};

export const GET = handle(async (req) => {
  if (!bearerOk(req)) throw new HttpError(401, 'Unauthorized');
  return Response.json(await mirror());
});

export const POST = handle(async (req) => {
  assertSameOrigin(req);
  await requireSuperAdmin();
  const r = await mirror();
  return Response.json({ ...r, message: r.status === 'skipped' ? 'Google Sheet already up to date.' : `Google Sheet updated (${r.rows} rows).` });
});
