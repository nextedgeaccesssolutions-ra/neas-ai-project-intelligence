'use client';
// Google Sheet sync status: last successful sync, latest attempt, and Sync now for Super Admins.
import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/cloud/browser';
import { useCloudStatus } from '@/lib/cloud/cloudSync';

type Row = { at: string; status: string; rows_written: number; error: string | null };
const when = (s: string) => new Date(s).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export default function SheetsSyncStatus() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const admin = useCloudStatus().profile?.global_role === 'super_admin';
  const load = () => supabaseBrowser()?.from('integration_sync_log').select('at, status, rows_written, error').order('at', { ascending: false }).limit(5).then(({ data }) => setRows((data as Row[]) ?? []));
  useEffect(() => { void load(); }, []);
  const lastOk = rows?.find((r) => r.status === 'ok' || r.status === 'skipped');
  const latest = rows?.[0];
  const sync = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/integrations/sheets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const j = await r.json().catch(() => ({}));
      setMsg(r.ok ? j.message ?? 'Google Sheet updated.' : j.error ?? `Sync failed (${r.status}).`);
      await load();
    } finally { setBusy(false); }
  };
  return (
    <div className="kv" style={{ maxWidth: 640, marginTop: 8 }}>
      <span className="note">Last successful sync</span><b>{lastOk ? `${when(lastOk.at)}${lastOk.status === 'skipped' ? ' (already up to date)' : ` · ${lastOk.rows_written} rows`}` : rows ? 'Not yet' : '…'}</b>
      <span className="note">Latest attempt</span><span className={latest?.status === 'error' ? 'bad' : undefined}>{latest ? `${when(latest.at)} · ${latest.status}${latest.error ? ` · ${latest.error}` : ''}` : '—'}</span>
      {admin && <><span /><span><button className="btn btn-sm btn-primary" onClick={sync} disabled={busy}>{busy ? 'Syncing…' : 'Sync now'}</button>{msg && <span className="note" style={{ marginLeft: 8 }}>{msg}</span>}</span></>}
    </div>
  );
}
