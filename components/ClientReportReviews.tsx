'use client';
// Client portal: project reports NEAS sent for review. The client opens the exact PDF and approves it
// or requests changes with a comment. The decision is tied to that file's fingerprint on the server.
import { useCallback, useEffect, useState } from 'react';
import type { ClientReport } from '@/app/api/client/reports/route';

const LABEL: Record<string, [string, string]> = { pending: ['Waiting for your review', 'pill-warn'], approved: ['Approved', 'pill-ok'], changes_requested: ['Changes requested', 'pill-bad'] };

export default function ClientReportReviews({ code }: { code: string }) {
  const [rows, setRows] = useState<ClientReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  // the list starts hidden; the client opens it with Show
  const [shown, setShown] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/client/reports?code=${encodeURIComponent(code)}`, { cache: 'no-store' }).catch(() => null);
    if (!r || !r.ok) { setRows(null); setError(r?.status === 401 ? 'Your session has ended. Sign in again to see reports for your review.' : null); return; }
    setRows(await r.json());
  }, [code]);
  useEffect(() => { void load(); }, [load]);

  const decide = async (rep: ClientReport, decision: 'approved' | 'changes_requested') => {
    setError(null);
    if (name.trim().length < 2) return setError('Enter your name.');
    if (decision === 'changes_requested' && comment.trim().length < 3) return setError('Say what should change.');
    setBusy(true);
    const r = await fetch('/api/client/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, exportId: rep.id, decision, name, comment, sha256: rep.sha256 }) }).catch(() => null);
    setBusy(false);
    if (!r) return setError('Sending your review needs an internet connection.');
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return setError(j.error ?? 'Your review could not be saved.');
    setOpen(null);
    setComment('');
    await load();
  };

  if (!rows) return error ? <section className="card"><p className="bad" role="alert">{error}</p></section> : null;
  if (!rows.length) return null;
  return (
    <section className="card">
      <div className="card-head"><h2>Reports for your review ({rows.length})</h2><span style={{ display: 'inline-flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}><span className="note">Open the report, then approve it or request changes</span><button className="btn btn-sm" onClick={() => setShown(!shown)} aria-expanded={shown}>{shown ? 'Hide' : 'Show'}</button></span></div>
      <div hidden={!shown} style={{ display: shown ? 'grid' : 'none', gap: 12 }}>
        {rows.map((rep) => {
          const [label, tone] = LABEL[rep.status] ?? [rep.status, ''];
          return (
            <div key={rep.id} className="card" style={{ margin: 0 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
                <div><b>{rep.report_ref}</b><div className="note">Sent {new Date(rep.sent_at).toLocaleString()}{rep.period_to ? ` · up to ${rep.period_to}` : ''}</div></div>
                <span className={`pill ${tone}`}>{label}</span>
              </div>
              <div className="form-actions">
                {rep.url ? <a className="btn btn-sm" href={rep.url} target="_blank" rel="noreferrer">Open report (PDF)</a> : <span className="note">The file is not available right now.</span>}
                {rep.status === 'pending' && open !== rep.id && <button className="btn btn-sm btn-primary" onClick={() => { setOpen(rep.id); setError(null); setComment(''); }}>Review</button>}
              </div>
              {rep.review && <p className="note">{rep.review.decision === 'approved' ? 'Approved' : 'Changes requested'} by {rep.review.name} on {new Date(rep.review.at).toLocaleString()}{rep.review.comment ? `: “${rep.review.comment}”` : ''}</p>}
              {open === rep.id && (
                <div className="auth-form" style={{ marginTop: 8 }}>
                  <label className="field">Your name<input className="input" autoComplete="name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></label>
                  <label className="field">Comment (required to request changes)<textarea className="input" rows={3} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} /></label>
                  {error && <p className="bad" role="alert">{error}</p>}
                  <p className="note">Your decision applies to this exact file. If NEAS sends a corrected report, you review that one separately.</p>
                  <div className="form-actions">
                    <button className="btn btn-primary" disabled={busy} onClick={() => decide(rep, 'approved')}>Approve</button>
                    <button className="btn" disabled={busy} onClick={() => decide(rep, 'changes_requested')}>Request changes</button>
                    <button className="btn" disabled={busy} onClick={() => setOpen(null)}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
