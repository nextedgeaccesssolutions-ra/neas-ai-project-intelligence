'use client';
// Google Sheets sync engine. Every change on this device mirrors all tabs to the NEAS sheet.
// Two transports:
//   • "connector"  – inside Claude (artifact), through the viewer's Google Sheets connector.
//   • "apps-script" – anywhere else (e.g. Vercel), through a Google Apps Script web app URL.
// The mirror is idempotent (whole tabs are rewritten), so a repeated sync never duplicates rows.
import { useSyncExternalStore } from 'react';
import type { AppState } from './types';
import { SHEET_ID, TAB_NAMES, gridToRows, rowsToGrid, rowsToState, stateToRows, TABS, type Cell, type Column, type Row, type TabName } from './sheetSchema';

export type SyncState = 'checking' | 'unavailable' | 'paused' | 'idle' | 'pending' | 'syncing' | 'synced' | 'error';
export interface SyncStatus {
  state: SyncState;
  transport: 'connector' | 'apps-script' | null;
  at: string | null; // last successful sync (ISO)
  message: string | null;
  code: string | null;
}

export interface SyncSettings {
  auto: boolean;
  scriptUrl: string;
  token: string;
  /** set after this device's first successful mirror */
  everSynced?: boolean;
}

const SETTINGS_KEY = 'neas-pc-sync-v1';
const CONNECTOR = 'Google Sheets';
const DEBOUNCE_MS = 3000;
const STOP_CODES = new Set(['server_not_connected', 'needs_reauth', 'not_in_manifest', 'approval_required', 'not_granted', 'capability_disabled', 'capability_removed', 'blocked_by_policy', 'selection_required', 'consent_required', 'tool_error', 'bad_request']);

// ---------- settings ----------
export function loadSettings(): SyncSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { auto: true, scriptUrl: '', token: '', ...JSON.parse(raw) };
  } catch {
    /* storage blocked */
  }
  return { auto: true, scriptUrl: '', token: '' };
}
export function saveSettings(s: SyncSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* storage blocked */
  }
  settings = s;
  if (!s.auto && status.state !== 'unavailable') set({ state: 'paused', message: 'Automatic sync is off.' });
  if (s.auto && status.state === 'paused') set({ state: 'idle', message: null });
  detected = null;
}

// ---------- status store ----------
let settings: SyncSettings = { auto: true, scriptUrl: '', token: '' };
let status: SyncStatus = { state: 'checking', transport: null, at: null, message: null, code: null };
const subs = new Set<() => void>();
function set(p: Partial<SyncStatus>) {
  status = { ...status, ...p };
  subs.forEach((f) => f());
}
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => status, () => status);
}

// ---------- transports ----------
type McpLike = { callTool: (server: string, tool: string, input?: unknown) => Promise<{ payload?: unknown }> };
interface Transport {
  kind: 'connector' | 'apps-script';
  write(tabs: Record<string, Cell[][]>): Promise<void>;
  read(): Promise<Record<string, unknown[][]>>;
}

let mcpPromise: Promise<McpLike | null> | null = null;
function getMcp(): Promise<McpLike | null> {
  if (!mcpPromise) {
    const c = (typeof window !== 'undefined' ? (window as unknown as { claude?: { use?: (n: string) => Promise<unknown> } }).claude : undefined);
    mcpPromise = c?.use ? (c.use('mcp') as Promise<McpLike | null>).catch(() => null) : Promise.resolve(null);
  }
  return mcpPromise;
}

const colLetter = (n: number) => String.fromCharCode(64 + n);

function connectorTransport(mcp: McpLike): Transport {
  return {
    kind: 'connector',
    async write(tabs) {
      const tails: string[] = [];
      for (const [tab, grid] of Object.entries(tabs)) {
        await mcp.callTool(CONNECTOR, 'update_values', { spreadsheetId: SHEET_ID, range: `${tab}!A1`, values: grid });
        tails.push(`${tab}!A${grid.length + 1}:Z`);
      }
      // remove rows left over from a longer previous version of each tab
      await mcp.callTool(CONNECTOR, 'batch_clear_values', { spreadsheetId: SHEET_ID, ranges: tails });
    },
    async read() {
      const out: Record<string, unknown[][]> = {};
      for (const tab of TAB_NAMES) {
        const r = await mcp.callTool(CONNECTOR, 'get_values', { spreadsheetId: SHEET_ID, range: `${tab}!A1:${colLetter((TABS[tab] as Column[]).length + 2)}` });
        const p = r.payload as { values?: unknown[][] } | undefined;
        out[tab] = p?.values ?? [];
      }
      return out;
    },
  };
}

function appsScriptTransport(url: string, token: string): Transport {
  return {
    kind: 'apps-script',
    async write(tabs) {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'mirror', token, tabs }) });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) throw { code: 'apps_script', message: j?.error ? `Apps Script: ${j.error}` : `Apps Script returned ${res.status}` };
    },
    async read() {
      const res = await fetch(`${url}?action=read&token=${encodeURIComponent(token)}`);
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) throw { code: 'apps_script', message: j?.error ? `Apps Script: ${j.error}` : `Apps Script returned ${res.status}` };
      return j.tabs as Record<string, unknown[][]>;
    },
  };
}

let detected: Transport | null = null;
async function transport(): Promise<Transport | null> {
  if (detected) return detected;
  const mcp = await getMcp();
  if (mcp) detected = connectorTransport(mcp);
  else if (settings.scriptUrl) detected = appsScriptTransport(settings.scriptUrl, settings.token);
  set({ transport: detected?.kind ?? null });
  return detected;
}

// ---------- error copy ----------
function explain(e: unknown): { code: string; message: string; retry: boolean; retryAfterMs?: number } {
  const err = (e ?? {}) as { code?: string; message?: string; retryable?: boolean; retryAfterMs?: number };
  const code = err.code ?? 'error';
  const m: Record<string, string> = {
    server_not_connected: 'Google Sheets is not connected. Add it in claude.ai Settings → Connectors, then press Sync now.',
    needs_reauth: 'Google Sheets needs to be reconnected in claude.ai Settings → Connectors.',
    approval_required: 'Allow this page to use Google Sheets: press Sync now and approve the prompt.',
    not_in_manifest: 'Google Sheets access is turned off for this page. Turn it on in the page’s Permissions menu.',
    selection_required: 'You have more than one Google Sheets connector. Pick one when prompted, then press Sync now.',
    blocked_by_policy: 'Your organization blocks Google Sheets for this page.',
    server_unavailable: 'Google Sheets did not respond. Will retry.',
    tool_error: `Google Sheets refused the update${err.message ? `: ${err.message}` : ''}. Check that your Google account can edit the NEAS sheet.`,
    apps_script: err.message ?? 'Apps Script error.',
  };
  return { code, message: m[code] ?? err.message ?? 'Sync failed.', retry: !!err.retryable, retryAfterMs: err.retryAfterMs };
}

// ---------- engine ----------
let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let dirty = false;
let latest: AppState | null = null;
let who = '';
let blocked = false; // a stop-code error: wait for a manual Sync now

function gridsFor(st: AppState): Record<string, Cell[][]> {
  const rows = stateToRows(st);
  const tabs: Record<string, Cell[][]> = {};
  for (const t of TAB_NAMES) tabs[t] = rowsToGrid(t, rows[t]);
  const now = new Date().toISOString();
  tabs.Sync_Info = [
    ['Field', 'Value'],
    ['Last sync', now],
    ['Synced by', who || 'NEAS Project Control user'],
    ['Source', 'NEAS Project Control web app'],
    ['Projects', st.projects.length],
    ['Activities', st.activities.length],
    ['Field reports', st.reports.length],
    ['BOQ lines', st.boq.length],
    ['Note', 'This sheet is rewritten on every change in the app. Edit data in the app; use "Load from Google Sheet" there to pull sheet edits back.'],
  ];
  return tabs;
}

async function run(manual = false) {
  if (running) {
    dirty = true;
    return;
  }
  if (!latest) return;
  if (!manual && (!settings.auto || blocked)) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    set({ state: 'pending', message: 'Offline. Changes will sync when you are back online.' });
    return;
  }
  const t = await transport();
  if (!t) {
    set({ state: 'unavailable', message: 'No Google Sheets connection here. Open the app in Claude with Google Sheets connected, or set an Apps Script URL in Google Sheets setup.' });
    return;
  }
  running = true;
  dirty = false;
  set({ state: 'syncing', message: null, code: null });
  try {
    await t.write(gridsFor(latest));
    blocked = false;
    set({ state: 'synced', at: new Date().toISOString(), message: null, code: null });
    if (!settings.everSynced) saveSettings({ ...settings, everSynced: true });
  } catch (e) {
    const x = explain(e);
    if (STOP_CODES.has(x.code) || x.code === 'apps_script') blocked = true;
    set({ state: 'error', message: x.message, code: x.code });
    if (x.retry && !manual) setTimeout(() => run(), Math.min(60000, x.retryAfterMs ?? 5000 + Math.random() * 3000));
  } finally {
    running = false;
    if (dirty) schedule();
  }
}

function schedule() {
  if (timer) clearTimeout(timer);
  if (settings.auto && !blocked) set({ state: 'pending', message: null });
  timer = setTimeout(() => run(), DEBOUNCE_MS);
}

/** Called by the store after every local change. */
export function queueSync(st: AppState, userName: string) {
  latest = st;
  who = userName;
  if (!settings.auto) return;
  if (blocked) return;
  if (running) {
    dirty = true;
    return;
  }
  schedule();
}

/** Manual "Sync now": also clears a stop-code block (the call may show a consent prompt). */
export async function syncNow(st: AppState, userName: string) {
  latest = st;
  who = userName;
  blocked = false;
  if (timer) clearTimeout(timer);
  await run(true);
}

/** Read every tab back from the sheet and convert it to app state. */
export async function pullFromSheet(base: AppState): Promise<{ state: AppState; counts: Record<string, number> }> {
  const t = await transport();
  if (!t) throw new Error('No Google Sheets connection here.');
  set({ state: 'syncing', message: 'Loading from Google Sheet…' });
  try {
    const raw = await t.read();
    const tabs: Partial<Record<TabName, Row[]>> = {};
    const counts: Record<string, number> = {};
    for (const tab of TAB_NAMES) {
      tabs[tab] = gridToRows(TABS[tab] as Column[], raw[tab] ?? []);
      counts[tab] = tabs[tab]!.length;
    }
    const state = rowsToState(tabs, base);
    set({ state: 'synced', at: new Date().toISOString(), message: null, code: null });
    return { state, counts };
  } catch (e) {
    const x = e instanceof Error ? { message: e.message, code: 'parse' } : explain(e);
    set({ state: 'error', message: x.message, code: x.code });
    throw new Error(x.message);
  }
}

/** Boot: load settings, find the transport, and send this device's data once if it never has. */
export async function initSync(st: AppState, userName: string) {
  settings = loadSettings();
  latest = latest ?? st;
  who = who || userName;
  const t = await transport();
  if (!t) set({ state: 'unavailable', message: 'No Google Sheets connection here yet.' });
  else if (!settings.auto) set({ state: 'paused', message: 'Automatic sync is off.' });
  else if (!settings.everSynced) schedule();
  else set({ state: 'idle' });
}

export function currentSettings() {
  return settings;
}

export const APPS_SCRIPT_CODE = `/**
 * NEAS Project Control → Google Sheets bridge (for the Vercel / self-hosted version).
 * 1. In the NEAS sheet: Extensions → Apps Script, paste this file, Save.
 * 2. Project Settings → Script properties → add NEAS_TOKEN = a long random secret.
 * 3. Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone.
 * 4. Copy the web app URL and the token into the app's Google Sheets setup page.
 */
const SHEET_ID = '${SHEET_ID}';

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function authorized_(token) {
  const t = PropertiesService.getScriptProperties().getProperty('NEAS_TOKEN');
  return t && token === t;
}

function doPost(e) {
  const body = JSON.parse(e.postData.contents || '{}');
  if (!authorized_(body.token)) return json_({ ok: false, error: 'unauthorized' });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    Object.keys(body.tabs || {}).forEach(function (name) {
      const grid = body.tabs[name];
      const sh = ss.getSheetByName(name) || ss.insertSheet(name);
      sh.clearContents();
      if (grid.length) sh.getRange(1, 1, grid.length, grid[0].length).setValues(grid);
      sh.setFrozenRows(1);
    });
    return json_({ ok: true, at: new Date().toISOString() });
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  if (!authorized_(e.parameter.token)) return json_({ ok: false, error: 'unauthorized' });
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const tabs = {};
  ['Projects', 'Activities', 'Field_Reports', 'BOQ', 'Cost_Settings', 'Quotations', 'Site_Evidence'].forEach(function (name) {
    const sh = ss.getSheetByName(name);
    tabs[name] = sh ? sh.getDataRange().getDisplayValues() : [];
  });
  return json_({ ok: true, tabs: tabs });
}
`;
