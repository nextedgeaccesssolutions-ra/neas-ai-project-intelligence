'use client';
import { useEffect, useRef, useState } from 'react';
import { Loading } from '@/components/ProjectBar';
import DataIO from '@/components/DataIO';
import { useStore } from '@/lib/store';
import { askConfirm, IS_ARTIFACT, notify } from '@/components/Dialogs';
import { CLOUD } from '@/lib/cloud/env';
import SheetsSyncStatus from '@/components/SheetsSyncStatus';
import { APPS_SCRIPT_CODE, checkScriptUrl, currentSettings, pullFromSheet, saveSettings, syncNow, useSyncStatus, type SyncSettings } from '@/lib/sheetsSync';
import { SHEET_ID, SHEET_URL, TAB_NAMES, TABS, gridToRows, rowsToState, stateToRows, type Column, type Row, type TabName } from '@/lib/sheetSchema';
import { readWorkbook, saveFile, type ExportDoc } from '@/lib/fileio';
import type { AppState } from '@/lib/types';


const STATE_COPY: Record<string, { label: string; tone: string }> = {
  checking: { label: 'Checking connection…', tone: '' },
  unavailable: { label: 'Not connected', tone: 'pill-warn' },
  paused: { label: 'Auto-sync off', tone: 'pill-warn' },
  idle: { label: 'Connected', tone: 'pill-ok' },
  pending: { label: 'Changes waiting', tone: 'pill-warn' },
  syncing: { label: 'Syncing…', tone: '' },
  synced: { label: 'Up to date', tone: 'pill-ok' },
  error: { label: 'Sync problem', tone: 'pill-bad' },
};

function workbookDoc(st: AppState): ExportDoc {
  const rows = stateToRows(st);
  return {
    filename: `neas-project-control-all-data-${new Date().toISOString().slice(0, 10)}`,
    title: 'NEAS Project Control — all data',
    meta: [['Projects', String(st.projects.length)], ['Exported', new Date().toLocaleString()]],
    tables: TAB_NAMES.map((t) => ({ title: t, columns: TABS[t] as Column[], rows: rows[t] })),
  };
}

const SHEET_ID_SET = !!SHEET_ID;

export default function SheetsSetup() {
  const { ready, state, replaceAll, resetDemo } = useStore();
  // cloud: only Super Admins get the sheet's address, from the server
  const [sheetLink, setSheetLink] = useState<string | null>(null);
  useEffect(() => { if (CLOUD) fetch('/api/integrations/sheets/link').then((r) => (r.ok ? r.json() : null)).then((j) => setSheetLink(j?.url ?? null)).catch(() => undefined); }, []);
  const sync = useSyncStatus();
  const [cfg, setCfg] = useState<SyncSettings>({ auto: true, scriptUrl: '', token: '' });
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const backupRef = useRef<HTMLInputElement>(null);

  useEffect(() => setCfg(currentSettings()), [sync.transport]);
  if (!ready) return <Loading />;

  const copy = STATE_COPY[sync.state] ?? STATE_COPY.checking;
  const counts = { Projects: state.projects.length, Activities: state.activities.length, Field_Reports: state.reports.length, BOQ: state.boq.length, Cost_Settings: Object.keys(state.costSettings).length, Quotations: Object.keys(state.quotations).length, Site_Evidence: state.evidence.length } as Record<TabName, number>;

  const doSync = async () => {
    setBusy(true);
    await syncNow(state, state.userName);
    setBusy(false);
  };

  const doPull = async () => {
    if (!(await askConfirm('Replace the data on this device with what is in the Google Sheet? Changes made here since the last sync will be lost.'))) return;
    setBusy(true);
    try {
      const { state: next, counts: c } = await pullFromSheet(state);
      replaceAll(next);
      notify(`Loaded from Google Sheet: ${c.Projects} projects, ${c.Activities} activities, ${c.Field_Reports} reports, ${c.BOQ} BOQ lines.`);
    } catch (e) {
      notify(`Could not load: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const importWorkbook = async () => {
    const f = fileRef.current?.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!f) return;
    try {
      const books = await readWorkbook(f);
      const tabs: Partial<Record<TabName, Row[]>> = {};
      for (const t of TAB_NAMES) {
        const sheet = Object.keys(books).find((n) => n.toLowerCase() === t.toLowerCase());
        if (sheet) tabs[t] = gridToRows(TABS[t] as Column[], books[sheet]);
      }
      const next = rowsToState(tabs, state);
      const ok = await askConfirm(`Replace all data with this workbook? ${next.projects.length} projects, ${next.activities.length} activities, ${next.reports.length} field reports, ${next.boq.length} BOQ lines.`);
      if (!ok) return;
      replaceAll(next);
      notify('Workbook imported. The Google Sheet will update automatically.');
    } catch (e) {
      notify(`Import failed: ${(e as Error).message}`);
    }
  };

  const backup = async () => {
    const r = await saveFile(`neas-project-control-backup-${new Date().toISOString().slice(0, 10)}.json`, new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' })).catch((e: Error) => (notify(e.message), 'declined'));
    if (r === 'saved') notify('Backup saved.');
  };

  const restore = async () => {
    const f = backupRef.current?.files?.[0];
    if (backupRef.current) backupRef.current.value = '';
    if (!f) return;
    try {
      const s = JSON.parse(await f.text()) as AppState;
      if (s.version !== 1 || !Array.isArray(s.projects) || !Array.isArray(s.activities) || !Array.isArray(s.reports)) throw new Error('Not a NEAS Project Control backup file.');
      if (!(await askConfirm(`Replace all data with the backup (${s.projects.length} projects)? Photos are not included in backups.`))) return;
      replaceAll({ ...s, boq: s.boq ?? [], costSettings: s.costSettings ?? {}, quotations: s.quotations ?? {}, evidence: [] });
      notify('Backup restored.');
    } catch (e) {
      notify((e as Error).message);
    }
  };

  const saveCfg = (next: SyncSettings) => {
    setCfg(next);
    saveSettings(next);
  };

  const copyScript = async () => {
    try {
      await navigator.clipboard.writeText(APPS_SCRIPT_CODE);
      notify('Apps Script code copied.');
    } catch {
      notify('Clipboard blocked. Select the code and copy it.');
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Integrations</div>
          <h1>Google Sheets setup</h1>
          <p className="lead">Every change in the app is recorded in the NEAS Google Sheet automatically, one tab per record type.</p>
        </div>
        <div className="form-actions" style={{ marginTop: 0 }}>
          <DataIO doc={() => workbookDoc(state)} label="records" />
          {CLOUD ? sheetLink && <a className="btn btn-sm btn-primary" href={sheetLink} target="_blank" rel="noreferrer">Open Google Sheet ↗</a>
            : SHEET_URL && SHEET_ID_SET && <a className="btn btn-sm btn-primary" href={SHEET_URL} target="_blank" rel="noreferrer">Open Google Sheet ↗</a>}
        </div>
      </div>

      {CLOUD ? (
        <section className="card">
          <div className="card-head"><h2>Live sync</h2><span className="pill pill-ok"><span className="dot" />Server-managed</span></div>
          <p style={{ marginTop: 0 }}>The database is the system of record. The server copies projects, schedules, Gantt progress, project reports, site evidence with GPS and map links, BOQ, quotations, users and memberships to the NEAS Google Sheet through a signed Apps Script bridge.</p>
          <p className="note">Reports sync automatically: after a project report is generated, after changes reach the server (at most every 2 minutes), and once a day. Unchanged data is skipped. Passcodes, passwords and tokens are never sent to the sheet.</p>
          <SheetsSyncStatus />
        </section>
      ) : (
      <section className="card">
        <div className="card-head">
          <h2>Live sync</h2>
          <span className={`pill ${copy.tone}`}><span className="dot" />{copy.label}</span>
        </div>
        <div className="kv" style={{ maxWidth: 640 }}>
          <span className="note">Connection</span>
          <span>{sync.transport === 'connector' ? 'Google Sheets connector (your Google account)' : sync.transport === 'apps-script' ? 'Apps Script web app' : '—'}</span>
          <span className="note">Last successful sync</span>
          <span>{sync.at ? new Date(sync.at).toLocaleString() : 'Not yet'}</span>
          <span className="note">Recorded as</span>
          <span>{state.userName || <span className="note">Set your name on the Quotation page</span>}</span>
        </div>
        {sync.message && <p className={sync.state === 'error' ? 'bad' : 'note'} role="status">{sync.message}</p>}
        <div className="form-actions">
          <button className="btn btn-primary" onClick={doSync} disabled={busy || sync.state === 'syncing' || sync.state === 'unavailable'}>Sync now</button>
          <button className="btn" onClick={doPull} disabled={busy || sync.state === 'unavailable'}>Load from Google Sheet</button>
          <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input id="auto-sync" type="checkbox" checked={cfg.auto} onChange={(e) => saveCfg({ ...cfg, auto: e.target.checked })} />
            Sync automatically after every change
          </label>
        </div>
        <p className="note">
          The app rewrites each tab with its current records, so the sheet always matches the app and nothing is duplicated. Edit records in the app; if someone edits the sheet,
          use “Load from Google Sheet” to bring those edits in. Photos stay on the device that took them; their details are listed in the Site_Evidence tab.
        </p>
      </section>
      )}

      <section className="card">
        <div className="card-head"><h2>Sheet tabs</h2><span className="note">Rows sent on the next sync</span></div>
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Tab</th><th>Contents</th><th className="num">Rows</th></tr></thead>
            <tbody>
              {TAB_NAMES.map((t) => (
                <tr key={t}>
                  <td><code>{t}</code></td>
                  <td className="note">{(TABS[t] as Column[]).map((c) => c.label).join(' · ')}</td>
                  <td className="num">{counts[t]}</td>
                </tr>
              ))}
              <tr><td><code>Sync_Info</code></td><td className="note">Last sync time, who synced, record counts</td><td className="num">—</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      {!CLOUD && (
      <section className="card">
        <div className="card-head"><h2>Import a full workbook</h2><span className="note">Excel file with the same tab names</span></div>
        <p className="note" style={{ marginTop: 0 }}>Use an Excel export from this page (or a download of the Google Sheet as .xlsx). This replaces all records on this device.</p>
        <div className="form-actions" style={{ marginTop: 0 }}>
          <input ref={fileRef} id="wb-file" type="file" accept=".xlsx" className="input" style={{ maxWidth: 320 }} aria-label="Workbook file" />
          <button className="btn" onClick={importWorkbook}>Import workbook</button>
        </div>
      </section>
      )}

      {!IS_ARTIFACT && !CLOUD && (
        <section className="card">
          <div className="card-head"><h2>Apps Script connection</h2><span className="note">For the version hosted outside Claude</span></div>
          <ol className="note" style={{ marginTop: 0, paddingLeft: 18 }}>
            <li>Create an Apps Script project (<a href="https://script.google.com/create" target="_blank" rel="noreferrer">script.google.com</a>) and paste the code below.</li>
            <li>Run <code>createToken</code> once; copy the token it shows in the execution log.</li>
            <li>Deploy → New deployment → Web app → Execute as <b>Me</b>, access <b>Anyone</b>. Copy the <b>Web app URL ending in /exec</b> (not the editor address) and paste it and the token here.</li>
          </ol>
          <div className="form-grid">
            <label className="field" style={{ gridColumn: 'span 2' }}>Web app URL
              <input id="script-url" className="input" value={cfg.scriptUrl} placeholder="https://script.google.com/macros/s/…/exec" onChange={(e) => setCfg({ ...cfg, scriptUrl: e.target.value.trim() })} />
            </label>
            <label className="field">Token
              <input id="script-token" className="input" type="password" value={cfg.token} onChange={(e) => setCfg({ ...cfg, token: e.target.value })} />
            </label>
          </div>
          <div className="form-actions">
            <button className="btn btn-primary" onClick={() => {
              const bad = checkScriptUrl(cfg.scriptUrl);
              if (bad) return notify(bad);
              if (!cfg.token.trim()) return notify('Paste the token too (run createToken in the Apps Script to see it).');
              saveCfg({ ...cfg, token: cfg.token.trim() });
              notify('Connection saved. Press Sync now to test it.');
            }}>Save connection</button>
            <button className="btn" onClick={copyScript}>Copy Apps Script code</button>
          </div>
          <details style={{ marginTop: 12 }}>
            <summary className="note">Show Apps Script code</summary>
            <code className="block">{APPS_SCRIPT_CODE}</code>
          </details>
        </section>
      )}

      <section className="card">
        <div className="card-head"><h2>Backup and restore</h2><span className="note">Device data; photos are not included</span></div>
        <div className="form-actions" style={{ marginTop: 0 }}>
          <button className="btn btn-primary" onClick={backup}>Download backup (.json)</button>
          {!CLOUD && <>
          <input ref={backupRef} id="backup-file" type="file" accept="application/json,.json" className="input" style={{ maxWidth: 320 }} aria-label="Backup file" />
          <button className="btn" onClick={restore}>Restore from backup</button>
          <button className="btn btn-danger" onClick={() => askConfirm('Reset this device to the starting sample data? Everything entered here will be lost.').then((ok) => ok && resetDemo())}>Reset to starting data</button>
          </>}
        </div>
      </section>
    </>
  );
}
