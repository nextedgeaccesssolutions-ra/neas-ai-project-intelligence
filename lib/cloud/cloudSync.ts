'use client';
// Cloud mode engine: hydrates the app from Supabase (RLS-filtered), turns every local change
// into an outbox operation, and syncs whenever the device is online.
import { useSyncExternalStore } from 'react';
import type { AppState, Evidence } from '../types';
import { supabaseBrowser } from './browser';
import { FILES_BUCKET, OFFLINE_GRACE_HOURS } from './env';
import * as M from './mapping';
import { forgetOfflineLogin, recentOfflineUnlock } from '../offlineLogin';
import { allOps, enqueue, getMeta, onOutboxChange, processOutbox, rebaseOps, resolveConflict, setMeta, uuid, type ApplyResult, type Entity, type Operation } from '../offline/outbox';
import { getPhoto } from '../photos';

export type AuthState = 'checking' | 'signed_out' | 'pending' | 'active' | 'offline_grace' | 'expired';
export interface Membership { project_id: string; role: 'project_manager' | 'employee'; can_approve_reports: boolean }
export interface Profile { id: string; email: string; full_name: string; global_role: 'super_admin' | 'staff'; status: string; email_verified_at: string | null; allowed_views?: string[] | null; password_set_at?: string | null; is_client?: boolean }

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

// what the server renders with; the browser uses it while taking over the server page, so both draw the same first screen
const INITIAL: CloudStatus = { auth: 'checking', online: true, profile: null, memberships: [], pending: 0, conflicts: 0, rejected: 0, syncing: false, lastSyncAt: null, error: null };
let status: CloudStatus = INITIAL;
const subs = new Set<() => void>();
const set = (p: Partial<CloudStatus>) => {
  status = { ...status, ...p };
  subs.forEach((f) => f());
};
export const useCloudStatus = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => status, () => INITIAL);
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
// pages that show the same data as a module need that module's permission
const ALIAS: [string, ViewKey][] = [['/photos', 'site_evidence'], ['/map', 'site_evidence'], ['/scan', 'projects']];
export const viewOfPath = (path: string): ViewKey | null => {
  const alias = ALIAS.find(([p]) => path.startsWith(p));
  if (alias) return alias[1];
  const hit = VIEWS.filter(([, , href]) => (href === '/' ? path === '/' : path.startsWith(href)));
  return hit.length ? hit[hit.length - 1][0] : null;
};
/** null allowed_views = every module. Super Admins always see everything. */
/** Modules every signed-in user always has, whatever their module settings. */
export const ALWAYS_VIEWS: readonly ViewKey[] = ['field_reports'];
/** A client account opens these modules read only and sees only what is shared with the client (enforced in the database). */
export const CLIENT_VIEWS: ViewKey[] = VIEWS.map(([k]) => k);
export const isClientViews = (v: readonly string[] | null | undefined) => !!v && v.length === CLIENT_VIEWS.length && CLIENT_VIEWS.every((k) => v.includes(k));
/** The signed-in account is a client (read-only, shared items only). */
// the database flag decides; the module list is only a fallback for a cached profile from before the flag existed
export const isClientAccount = (profile: Profile | null = status.profile) => !!profile && profile.global_role !== 'super_admin' && (profile.is_client ?? isClientViews(profile.allowed_views));
export const canView = (view: ViewKey | null, profile: Profile | null = status.profile) =>
  !view || !profile || (ALWAYS_VIEWS.includes(view) && !isClientViews(profile.allowed_views)) || profile.global_role === 'super_admin' || !profile.allowed_views || profile.allowed_views.includes(view);

// ---------------------------------------------------------------------------
type Versions = Record<string, { id: string; version: number }>;
let versions: Versions = {};
let lastNudge = 0;
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

const mergeStops = <T extends { id: string }>(server: T[], local: T[]) => {
  const ids = new Set(local.map((s) => s.id));
  return [...server.filter((s) => !ids.has(s.id)), ...local];
};

// calendar edits not yet accepted by the server (offline or failed); retried on every sync
const pendingCalendars = new Map<string, import('../schedule').WorkCalendar>();
async function flushCalendars() {
  const sb = supabaseBrowser();
  if (!sb) return;
  for (const [pid, cal] of pendingCalendars) {
    const { error } = await sb.from('project_calendars').upsert(M.calendarToDb(pid, cal), { onConflict: 'project_id' });
    if (!error) pendingCalendars.delete(pid);
    else set({ error: `Calendar not saved yet (will retry): ${error.message}` });
  }
}

// stop/restart events go straight to the table (append-only); unsent ones are retried on every sync
const pendingStops = new Map<string, { op: 'stop' | 'restart'; stop: AppState['stops'] extends (infer T)[] | undefined ? T : never }>();
async function flushStops() {
  const sb = supabaseBrowser();
  if (!sb) return;
  for (const [key, { op, stop }] of pendingStops) {
    // a restart waits until its stop is on the server
    if (op === 'restart' && pendingStops.has(`${stop.id}:stop`)) continue;
    let error: { code?: string; message: string } | null;
    if (op === 'stop') ({ error } = await sb.from('activity_stops').insert(M.stopToDb(stop)));
    else {
      const res = await sb.from('activity_stops').update(M.restartToDb(stop)).eq('id', stop.id).is('restarted_at', null).select('id');
      error = res.error ?? (res.data?.length ? null : { code: '42501', message: 'only the project manager or a Super Admin can confirm a restart, or it was already restarted' });
    }
    // 23505: this stop was already recorded (a retry after a lost reply)
    if (!error || (op === 'stop' && error.code === '23505')) { pendingStops.delete(key); continue; }
    const permanent = ['42501', '23514', '22023', '23503', '23505'].includes(error.code ?? '') || (error.code ?? '').startsWith('PGRST');
    if (permanent) {
      pendingStops.delete(key);
      if (op === 'stop') pendingStops.delete(`${stop.id}:restart`);
      set({ error: `${op === 'stop' ? 'Stop' : 'Restart'} refused by the server: ${error.message}. The next sync shows the saved record.` });
    } else set({ error: `${op === 'stop' ? 'Stop' : 'Restart'} not saved yet (will retry): ${error.message}` });
  }
}

/** Load everything this user may see. Records with unsent local changes keep the local copy. */
export async function pullAll(): Promise<void> {
  const sb = supabaseBrowser();
  if (!sb || !apply || !read) return;
  const { data: all, error } = await sb.from('projects').select('*').order('code');
  if (error) throw error;
  // projects deleted in the Control panel are hidden everywhere else
  const projects = (all ?? []).filter((p: { deleted_at?: string | null }) => !p.deleted_at);
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
  await flushCalendars();
  await flushStops();
  const { data: stopRows } = await sb.from('activity_stops').select('*').order('stopped_at');
  bundle.stops = (stopRows ?? []) as M.DbStop[];
  // calendars are optional: before migration 000016 the table does not exist yet
  const { data: cals } = await sb.from('project_calendars').select('*');
  bundle.calendars = (cals ?? []) as M.DbCalendar[];
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
    calendars: { ...server.calendars, ...Object.fromEntries(pendingCalendars) },
    stops: mergeStops(server.stops ?? [], [...pendingStops.values()].map((x) => x.stop)),
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
  // client accounts are read only: local changes are never sent (the database refuses them anyway)
  if (isClientAccount()) return;
  const isUuid = (id: string) => /^[0-9a-f-]{36}$/i.test(id);
  // device-mode ids (e.g. "act_x1") are converted: cloud records always use UUIDs
  await queueCollection('activities', prev.activities, next.activities.filter((a) => isUuid(a.id)), M.activityToDb);
  await queueCollection('project_reports', prev.reports, next.reports.filter((r) => isUuid(r.id)), M.reportToDb);
  await queueCollection('boq_lines', prev.boq, next.boq.filter((b) => isUuid(b.id)), M.boqToDb);
  await queueCollection<Evidence>('report_attachments', prev.evidence, next.evidence.filter((e) => isUuid(e.id)), (e) => M.evidenceToDb({ ...e, storagePath: e.storagePath ?? `${e.projectId}/${e.id}.jpg` }), (e) => ({ blob_key: e.id }));
  const before = new Map((prev.stops ?? []).map((s) => [s.id, s]));
  for (const s of next.stops ?? []) {
    const old = before.get(s.id);
    if (!old) pendingStops.set(`${s.id}:stop`, { op: 'stop', stop: s });
    if (s.restartedAt && !old?.restartedAt) pendingStops.set(`${s.id}:restart`, { op: 'restart', stop: s });
  }
  if (pendingStops.size) await flushStops();
  // calendars write straight to the table (online only; PM or Super Admin, enforced by RLS)
  const sb = supabaseBrowser();
  for (const [pid, cal] of Object.entries(next.calendars ?? {})) {
    if (sb && !same(prev.calendars?.[pid], cal)) {
      pendingCalendars.set(pid, cal);
      await flushCalendars();
    }
  }
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
  // signed in offline with a passcode only: nothing can be sent until a real online sign-in
  if (!(await supabaseBrowser()?.auth.getSession())?.data.session) return;
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
    // conflicts are not kept: the server copy wins and the device's stale edit is dropped (the pull below refreshes this device)
    let dropped = 0;
    for (const o of await allOps()) {
      if (o.status !== 'conflict') continue;
      // later edits of the same record move onto the server version so they are not dropped too
      const v = Number((o.server_record as { version?: number } | null)?.version);
      if (Number.isFinite(v)) await rebaseOps(o.entity, o.record_id, o.base_version, v);
      applyServerRecord(o);
      await resolveConflict(o.op_id, 'server');
      dropped++;
    }
    if (dropped) await setMeta('versions', versions);
    const left = await allOps();
    if (!rep.networkError && (dropped || !left.some((o) => o.status === 'pending'))) await pullAll();
    // ask the server to refresh the Google Sheet after real changes (it coalesces and skips duplicates)
    if (rep.applied.length && Date.now() - lastNudge > 120_000) { lastNudge = Date.now(); fetch('/api/integrations/sheets/nudge', { method: 'POST' }).catch(() => undefined); }
    set({ error: rep.networkError ? 'Connection problem. Will retry automatically.' : dropped ? `${dropped} change(s) had already been changed by someone else; the server version was kept.` : null, lastSyncAt: new Date().toISOString() });
  } catch (e) {
    set({ error: (e as Error).message });
  } finally {
    set({ syncing: false });
    await refreshCounts();
  }
}

/** Record new server versions after a direct update that bypassed the outbox, so later edits on this device are not refused as conflicts. */
export async function noteServerVersions(entity: Entity, rows: { id: string; version: number }[]) {
  for (const r of rows) {
    const old = versions[vkey(entity, r.id)]?.version ?? null;
    // only our own update happened in between; a bigger jump means someone else changed it too, so a later conflict must still show
    if (old === null || r.version !== old + 1) continue;
    versions[vkey(entity, r.id)] = { id: r.id, version: r.version };
    await rebaseOps(entity, r.id, old, r.version);
  }
  await setMeta('versions', versions);
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
  const { data: profile } = await sb.from('profiles').select('id, email, full_name, username, global_role, status, email_verified_at, allowed_views, password_set_at, is_client').eq('id', u.user.id).single();
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
  // a passcode just checked offline on this device unlocks the cached identity of that same username
  const unlocked = !online ? recentOfflineUnlock() : null;
  if (!sess.session && !unlocked) return set({ auth: 'signed_out' });
  if (online) {
    try {
      await loadIdentity();
    } catch {
      set({ error: 'Could not reach the server.' });
    }
  }
  if (!online || status.auth === 'checking') {
    const id = await getMeta<{ profile: Profile; memberships: Membership[]; verified_at: number }>('identity');
    const fresh = id && (Date.now() - id.verified_at < OFFLINE_GRACE_HOURS * 3600 * 1000 || (!!unlocked && (id.profile as { username?: string | null }).username === unlocked));
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
  const who = (status.profile as { username?: string | null } | null)?.username;
  await supabaseBrowser()?.auth.signOut();
  await setMeta('identity', null);
  if (who) forgetOfflineLogin(who);
  try { localStorage.removeItem('neas-offline-unlock'); } catch { /* storage blocked */ }
  clearCache();
  set({ auth: 'signed_out', profile: null, memberships: [] });
}
