'use client';
// Who created, changed, reviewed, approved or returned one field report — read from the audit log.
// The audit log is readable by Super Admins only (database rule); others see a short note.
import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/cloud/browser';

interface Row { at: string; action: string; actor_kind: string; actor_id: string | null; details: Record<string, unknown> | null }
const WORD: Record<string, string> = { insert: 'Created', update: 'Changed', delete: 'Deleted' };

export default function ReportHistory({ reportId, onClose }: { reportId: string; onClose: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const sb = supabaseBrowser();
    if (!sb) return setErr('History is kept on the server; this copy runs on the device only.');
    void (async () => {
      const { data, error } = await sb.from('audit_logs').select('at, action, actor_kind, actor_id, details').eq('target_id', reportId).order('at', { ascending: true }).limit(200);
      if (error) return setErr(`History could not be loaded: ${error.message}`);
      const list = (data ?? []) as Row[];
      setRows(list);
      const ids = [...new Set(list.map((r) => r.actor_id).filter((x): x is string => !!x))];
      if (ids.length) {
        const { data: ps } = await sb.from('profiles').select('id, full_name, email').in('id', ids);
        setNames(new Map((ps ?? []).map((p: { id: string; full_name: string | null; email: string | null }) => [p.id, p.full_name || p.email || 'Someone'])));
      }
    })();
  }, [reportId]);
  // an update is described by what changed: status (approve / return), client sharing, or other fields
  const label = (r: Row) => {
    const op = r.action.split(':')[0];
    if (op !== 'update') return WORD[op] ?? r.action;
    const d = (r.details ?? {}) as Record<string, { to?: unknown }>;
    const st = d.status?.to as string | undefined;
    if (st) return st === 'approved' ? 'Approved' : st === 'rejected' ? 'Returned for revision' : st === 'submitted' ? 'Submitted for review' : `Status: ${st}`;
    if (d.client_visible) return d.client_visible.to ? 'Shared with client' : 'Hidden from client';
    const keys = Object.keys(d);
    return keys.length ? `Changed: ${keys.join(', ').replace(/_/g, ' ')}` : 'Changed';
  };
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Report history" onClick={onClose}>
      <section className="modal card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="card-head"><h2>Report history</h2><button className="btn btn-sm" onClick={onClose} aria-label="Close">✕</button></div>
        {err ? <p className="note">{err}</p> : !rows ? <p className="note">Loading…</p> : !rows.length ? <p className="note">No history recorded for this report yet.</p> : (
          <ol className="fr-history">
            {rows.map((r, i) => (
              <li key={i}><b>{label(r)}</b><span className="note">{new Date(r.at).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })} · {r.actor_id ? names.get(r.actor_id) ?? 'Someone' : r.actor_kind}</span></li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
