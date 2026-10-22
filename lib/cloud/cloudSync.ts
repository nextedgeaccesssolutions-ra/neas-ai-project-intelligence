'use client';
// Cloud mode engine: hydrates the app from Supabase (RLS-filtered), turns every local change
// into an outbox operation, and syncs whenever the device is online.
import { useSyncExternalStore } from 'react';
import type { AppState, Evidence } from '../types';
import { supabaseBrowser } from './browser';
import { FILES_BUCKET, OFFLINE_GRACE_HOURS } from './env';
import * as M from './mapping';
import { allOps, enqueue, getMeta, onOutboxChange, processOutbox, setMeta, uuid, type ApplyResult, type Entity, type Operation } from '../offline/outbox';
import { getPhoto } from '../photos';

export type AuthState = 'checking' | 'signed_out' | 'pending' | 'active' | 'offline_grace' | 'expired';
export interface Membership { project_id: string; role: 'project_manager' | 'employee'; can_approve_reports: boolean }
export interface Profile { id: string; email: string; full_name: string; global_role: 'super_admin' | 'staff'; status: string; email_verified_at: string | null; allowed_views?: string[] | null; password_set_at?: string | null }

export interface CloudStatus {
  auth: AuthState;
  online: boolean;
  profile: Profile | null;
  memberships: Membership[];
  pending: number;
  conflicts: number;
  rejected: number;
  syncing: boolean;
  lastSyncAt: string | null;
  error: string | null;
}

let status: CloudStatus = { auth: 'checking', online: true, profile: null, memberships: [], pending: 0, conflicts: 0, rejected: 0, syncing: false, lastSyncAt: null, error: null };
const subs = new Set<() => void>();
const set = (p: Partial<CloudStatus>) => {
  status = { ...status, ...p };
  subs.forEach((f) => f());
};
export const useCloudStatus = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => status, () => status);
export const cloudStatusNow = () => status;

/** Role helpers for the UI (the database enforces the same rules). */
export const isSuperAdmin = () => status.profile?.global_role === 'super_admin';
export const roleIn = (projectId: string) => (isSuperAdmin() ? 'super_admin' : status.memberships.find((m) => m.project_id === projectId)?.role ?? null);
export const canManage = (projectId: string) => isSuperAdmin() || roleIn(projectId) === 'project_manager';

/** Modules the administrator can switch on or off per user (enforced again in the database). */
export const VIEWS = [
  ['overview', 'Overview', '/'], ['estimating', 'Estimating & BOQ', '/estimating'], ['quotation', 'Quotation preview', '/quotation'],
  ['project_management', 'Project management', '/project-management'], ['field_reports', 'Field reports', '/field-reports'],
  ['projects', 'Project register', '/projects'], ['site_evidence', 'Site evidence', '/site-evidence'],
  ['google_sheets', 'Google Sheets setup', '/google-sheets'], ['offline_queue', 'Offline queue', '/offline-queue'],
] as const;
export type ViewKey = (typeof VIEWS)[number][0];
export const viewOfPath = (path: string): ViewKey | null => {
  const hit = VIEWS.filter(([, , href]) => (href === '/' ? path === '/' : path.startsWith(href)));
  return hit.length ? hit[hit.length - 1][0] : null;
};
/** null allowed_views = every module. Super Admins always see everything. */
/** Modules every signed-in user always has, whatever their module settings. */
export const ALWAYS_VIEWS: readonly ViewKey[] = ['field_reports'];
export const canView = (view: ViewKey | null, profile: Profile | null = status.profile) =>
  !view || !profile || ALWAYS_VIEWS.includes(view) || profile.global_role === 'super_admin' || !profile.allowed_views || profile.allowed_views.includes(view);

// ---------------------------------------------------------------------------
type Versions = Record<string, { id: string; version: number }>;
let versions: Versions = {};
let apply: ((s: AppState) => void) | null = null;
let read: (() => AppState) | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

const vkey = (entity: Entity, key: string) => `${entity}:${key}`;

async function refreshCounts() {
  const ops = await allOps();
  set({
    pending: ops.filter((o) => o.status === 'pending' || o.status === 'syncing').length,
    conflicts: ops.filter((o) => o.status === 'conflict').length,
    rejected: ops.filter((o) => o.status === 'rejected').length,
  });
}

function rememberVersions(b: M.DbBundle) {
  for (const a of b.activities) versions[vkey('activities', a.id)] = { id: a.id, version: a.version };
  for (const r of b.reports) versions[vkey('project_reports', r.id)] = { id: r.id, version: r.version };
  for (const l of b.boq) versions[vkey('boq_lines', l.id)] = { id: l.id, version: l.version };
  for (const f of b.attachments) versions[vkey('report_attachments', f.id)] = { id: f.id, version: f.version };
  for (const c of b.costs) versions[vkey('cost_settings', c.project_id)] = { id: c.id, version: c.version };
  for (const q of b.quotes) versions[vkey('quotations', q.project_id)] = { id: q.id, version: q.version };
}

/** Load everything this user may see. Records with unsent local changes keep the local copy. */
export async function pullAll(): Promise<void> {
  const sb = supabaseBrowser();
  if (!sb || !apply || !read) return;
  const { data: projects, error } = await sb.from('projects').select('*').order('code');
  if (error) throw error;
  const bundle: M.DbBundle = { projects: projects as M.DbProject[], activities: [], reports: [], boq: [], costs: [], quotes: [], attachments: [] };
  for (const p of projects ?? []) {
    const { data, error: e2 } = await sb.rpc('pull_changes', { p_project: p.id });
    if (e2) throw e2;
    const d = data as { activities: M.DbActivity[]; reports: M.DbReport[]; attachments: M.DbAttachment[]; boq_lines: M.DbBoq[]; cost_settings: M.DbCost | null; quotation: M.DbQuote | null };
    bundle.activities.push(...d.activities);
    bundle.reports.push(...d.reports);
    bundle.attachments.push(...d.attachments);
    bundle.boq.push(...d.boq_lines);
    if (d.cost_settings) bundle.costs.push(d.cost_settings);
    if (d.quotation) bundle.quotes.push(d.quotation);
  }
  rememberVersions(bundle);
  await setMeta('versions', versions);
  const server = M.bundleToState(bundle, read());
  const local = read();
  const unsent = new Set((await allOps()).map((o) => o.record_id));
  const keep = <T extends { id: string }>(srv: T[], loc: T[]) => {
    const locals = loc.filter((x) => unsent.has(x.id));
    return [...srv.filter((x) => !unsent.has(x.id)), ...locals];
  };
  apply({
    ...server,
    activities: keep(server.activities, local.activities),
    reports: keep(server.reports, local.reports),
    boq: keep(server.boq, local.boq),
    evidence: keep(server.evidence, local.evidence),
    userName: status.profile?.full_name || local.userName,
  });
  set({ lastSyncAt: new Date().toISOString(), error: null });
}

// ---------------------------------------------------------------------------
// Local change → outbox
// ---------------------------------------------------------------------------
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

async function queueCollection<T extends { id: string; projectId: string }>(entity: Entity, prev: T[], next: T[], toDb: (x: T) => Record<string, unknown>, extra?: (x: T) => Partial<Operation>) {
  const before = new Map(prev.map((x) => [x.id, x]));
  const after = new Map(next.map((x) => [x.id, x]));
  const userId = status.profile?.id ?? '';
  for (const [id, x] of after) {
    const old = before.get(id);
    if (old && same(toDb(old), toDb(x))) continue;
    await enqueue({ entity, op: 'upsert', record_id: id, project_id: x.projectId, base_version: versions[vkey(entity, id)]?.version ?? null, payload: toDb(x), user_id: userId, ...(old ? {} : extra?.(x)) });
  }
  for (const [id, x] of before) {
    if (after.has(id)) continue;
    await enqueue({ entity, op: 'delete', record_id: id, project_id: x.projectId, base_version: versions[vkey(entity, id)]?.version ?? null, payload: {}, user_id: userId });
  }
}

/** Called by the store after every local change in cloud mode. */
export async function cloudOnChange(prev: AppState, next: AppState) {
  if (status.auth !== 'active' && status.auth !== 'offline_grace') return;
  const isUuid = (id: string) => /^[0-9a-f-]{36}$/i.test(id);
  // device-mode ids (e.g. "act_x1") are converted: cloud records always use UUIDs
  await queueCollection('activities', prev.activities, next.activities.filter((a) => isUuid(a.id)), M.activityToDb);
  await queueCollection('project_reports', prev.reports, next.reports.filter((r) => isUuid(r.id)), M.reportToDb);
  await queueCollection('boq_lines', prev.boq, next.boq.filter((b) => isUuid(b.id)), M.boqToDb);
  await queueCollection<Evidence>('report_attachments', prev.evidence, next.evidence.filter((e) => isUuid(e.id)), (e) => M.evidenceToDb({ ...e, storagePath: e.storagePath ?? `${e.projectId}/${e.id}.jpg` }), (e) => ({ blob_key: e.id }));
  for (const pid of new Set([...Object.keys(next.costSettings), ...Object.keys(prev.costSettings)])) {
    const a = prev.costSettings[pid], b = next.costSettings[pid];
    if (b && !same(a, b)) {
      const known = versions[vkey('cost_settings', pid)];
      const id = known?.id ?? uuid();
      versions[vkey('cost_settings', pid)] = known ?? { id, version: 0 };
      await enqueue({ entity: 'cost_settings', op: 'upsert', record_id: id, project_id: pid, base_version: known?.version ?? null, payload: M.costToDb(b), user_id: status.profile?.id ?? '' });
    }
  }
  for (const pid of new Set([...Object.keys(next.quotations), ...Object.keys(prev.quotations)])) {
    const a = prev.quotations[pid], b = next.quotations[pid];
    if (b && !same(a, b)) {
      const known = versions[vkey('quotations', pid)];
      const id = known?.id ?? uuid();
      versions[vkey('quotations', pid)] = known ?? { id, version: 0 };
      await enqueue({ entity: 'quotations', op: 'upsert', record_id: id, project_id: pid, base_version: known?.version ?? null, payload: M.quoteToDb(b), user_id: status.profile?.id ?? '' });
    }
  }
  await setMeta('versions', versions);
  scheduleSync(800);
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------
const send = async (op: Operation): Promise<ApplyResult> => {
  const sb = supabaseBrowser();
  if (!sb) throw new Error('offline');
  const { data, error } = await sb.rpc('apply_operation', {
    p_op: { op_id: op.op_id, entity: op.entity, op: op.op, record_id: op.record_id, project_id: op.project_id, base_version: op.base_version, payload: op.payload, client_created_at: op.created_at },
  });
  if (error) {
    const code = (error as { code?: string }).code ?? '';
    // auth/network/server trouble: retry later; anything else: rejected for review
    if (!code || code.startsWith('PGRST3') || /fetch|network|timeout|JWT/i.test(error.message)) throw new Error(error.message);
    return { status: 'rejected', error: error.message };
  }
  return data as ApplyResult;
};

const upload = async (op: Operation) => {
  const sb = supabaseBrowser();
  if (!sb || !op.blob_key) return;
  const blob = await getPhoto(op.blob_key);
  if (!blob) throw new Error('Photo is no longer on this device');
  const path = String(op.payload.storage_path);
  const { error } = await sb.storage.from(FILES_BUCKET).upload(path, blob, { upsert: true, contentType: blob.type || 'image/jpeg' });
  if (error && !/exists/i.test(error.message)) throw new Error(error.message);
};

let syncTimer: ReturnType<typeof setTimeout> | null = null;
export function scheduleSync(ms = 0) {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => void syncNow(), ms);
}

export async function syncNow(): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return set({ online: false });
  if (status.auth !== 'active' && status.auth !== 'offline_grace') return;
  set({ syncing: true });
  try {
    const rep = await processOutbox(send, upload);
    for (const op of rep.applied) {
      const rec = rep.results.get(op.op_id)?.record as { id?: string; version?: number } | undefined;
      if (rec?.version != null) {
        const key = op.entity === 'cost_settings' || op.entity === 'quotations' ? op.project_id : op.record_id;
        versions[vkey(op.entity, key)] = { id: op.record_id, version: rec.version };
      }
    }
    await setMeta('versions', versions);
    const left = await allOps();
    if (!rep.networkError && !left.some((o) => o.status === 'pending')) await pullAll();
    set({ error: rep.networkError ? 'Connection problem. Will retry automatically.' : null, lastSyncAt: new Date().toISOString() });
  } catch (e) {
    set({ error: (e as Error).message });
  } finally {
    set({ syncing: false });
    await refreshCounts();
  }
}

/** Use the server's copy for a conflicted record (after the person chose it). */
export function applyServerRecord(op: Operation) {
  if (!apply || !read || !op.server_record) return;
  const st = read();
  const r = op.server_record as never;
  if (op.entity === 'activities') apply({ ...st, activities: st.activities.map((a) => (a.id === op.record_id ? M.activityFromDb(r) : a)) });
  if (op.entity === 'project_reports') apply({ ...st, reports: st.reports.map((a) => (a.id === op.record_id ? M.reportFromDb(r) : a)) });
  if (op.entity === 'boq_lines') apply({ ...st, boq: st.boq.map((a) => (a.id === op.record_id ? M.boqFromDb(r) : a)) });
  const v = Number((op.server_record as { version?: number }).version);
  if (Number.isFinite(v)) versions[vkey(op.entity, op.entity === 'cost_settings' || op.entity === 'quotations' ? op.project_id : op.record_id)] = { id: op.record_id, version: v };
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------
async function loadIdentity(): Promise<void> {
  const sb = supabaseBrowser()!;
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return set({ auth: 'signed_out', profile: null, memberships: [] });
  const { data: profile } = await sb.from('profiles').select('id, email, full_name, global_role, status, email_verified_at, allowed_views, password_set_at').eq('id', u.user.id).single();
  const { data: memberships } = await sb.from('project_memberships').select('project_id, role, can_approve_reports').eq('user_id', u.user.id);
  const active = profile?.status === 'active' && !!profile.email_verified_at;
  await setMeta('identity', { profile, memberships, verified_at: Date.now() });
  set({ profile: (profile as Profile) ?? null, memberships: (memberships as Membership[]) ?? [], auth: active ? 'active' : 'pending' });
}

/** Boot in cloud mode. Works offline for a signed-in user within the grace period. */
export async function cloudBoot(applyState: (s: AppState) => void, readState: () => AppState) {
  apply = applyState;
  read = readState;
  versions = (await getMeta<Versions>('versions')) ?? {};
  const sb = supabaseBrowser();
  if (!sb) return;
  const online = typeof navigator === 'undefined' || navigator.onLine;
  set({ online });
  const { data: sess } = await sb.auth.getSession();
  if (!sess.session) return set({ auth: 'signed_out' });
  if (online) {
    try {
      await loadIdentity();
    } catch {
      set({ error: 'Could not reach the server.' });
    }
  }
  if (!online || status.auth === 'checking') {
    const id = await getMeta<{ profile: Profile; memberships: Membership[]; verified_at: number }>('identity');
    const fresh = id && Date.now() - id.verified_at < OFFLINE_GRACE_HOURS * 3600 * 1000;
    if (id?.profile && fresh && id.profile.status === 'active') set({ auth: 'offline_grace', profile: id.profile, memberships: id.memberships });
    else set({ auth: 'expired' });
  }
  await refreshCounts();
  onOutboxChange(() => void refreshCounts());
  if (status.auth === 'active') {
    await pullAll().catch((e) => set({ error: (e as Error).message }));
    scheduleSync(0);
  }
  window.addEventListener('online', async () => {
    set({ online: true });
    if (status.auth === 'offline_grace' || status.auth === 'expired') await loadIdentity().catch(() => undefined);
    scheduleSync(0);
  });
  window.addEventListener('offline', () => set({ online: false }));
  sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') set({ auth: 'signed_out', profile: null, memberships: [] });
  });
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    if (navigator.onLine) scheduleSync(0);
  }, 60_000);
}

/** Sign out and remove cached project data from this device (unsent changes are kept unless the person discards them). */
export async function cloudSignOut(clearCache: () => void) {
  await supabaseBrowser()?.auth.signOut();
  await setMeta('identity', null);
  clearCache();
  set({ auth: 'signed_out', profile: null, memberships: [] });
}
