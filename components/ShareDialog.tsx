'use client';
// Share a project's approved report view by e-mail, QR code or link. Every link is a server-checked
// token that expires and can be withdrawn; the raw link is shown once and never stored.
import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { supabaseBrowser } from '@/lib/cloud/browser';
import { askConfirm, notify } from '@/components/Dialogs';
import { defaultSubject, validEmail } from '@/lib/shareEmail';
import { fmtDate } from '@/lib/format';

type Tab = 'email' | 'qr' | 'link';
type Share = { id: string; method: 'link' | 'qr' | 'email'; recipient_email: string | null; label: string; created_at: string; expires_at: string; revoked_at: string | null; open_count: number; last_opened_at: string | null };
type Created = { url: string; expiresAt: string };

const DAYS = [1, 7, 30, 90];
const when = (s: string) => new Date(s).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
export const shareState = (s: Pick<Share, 'revoked_at' | 'expires_at'>, now = Date.now()) => (s.revoked_at ? 'Withdrawn' : Date.parse(s.expires_at) <= now ? 'Expired' : 'Active');

export default function ShareDialog({ projectId, projectCode, projectName, onClose }: { projectId: string; projectCode: string; projectName: string; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('email');
  const [days, setDays] = useState(7);
  const [shares, setShares] = useState<Share[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabaseBrowser()!.from('report_shares')
      .select('id, method, recipient_email, label, created_at, expires_at, revoked_at, open_count, last_opened_at')
      .eq('project_id', projectId).order('created_at', { ascending: false }).limit(50);
    setListError(error ? 'Could not load the existing links.' : null);
    setShares((data as Share[]) ?? []);
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    box.current?.querySelector<HTMLElement>('[role=tab][aria-selected=true]')?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const create = async (method: 'link' | 'qr', label: string): Promise<Created | null> => {
    const { data, error } = await supabaseBrowser()!.rpc('create_report_share', { p_project: projectId, p_method: method, p_days: days, p_label: label });
    if (error || !data) {
      notify(error?.message ?? 'Could not create the link.');
      return null;
    }
    void load();
    return { url: `${window.location.origin}/share#${(data as { token: string }).token}`, expiresAt: (data as { expires_at: string }).expires_at };
  };

  const revoke = async (s: Share) => {
    if (!(await askConfirm(`Withdraw this ${s.method === 'email' ? `e-mail link to ${s.recipient_email}` : s.method === 'qr' ? 'QR code' : 'link'}? Anyone using it will see "withdrawn" from now on.`))) return;
    const { error } = await supabaseBrowser()!.rpc('revoke_report_share', { p_share: s.id });
    notify(error ? `Not withdrawn: ${error.message}` : 'Link withdrawn.');
    void load();
  };

  const tabs: [Tab, string][] = [['email', 'Email'], ['qr', 'QR code'], ['link', 'Share link']];
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card share-card" role="dialog" aria-modal="true" aria-labelledby="share-title" ref={box}>
        <div className="card-head">
          <div>
            <div className="eyebrow">{projectCode}</div>
            <h2 id="share-title" style={{ margin: 0 }}>Share {projectName}</h2>
          </div>
          <button className="btn btn-sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className="note">
          Recipients see only what is approved for the client view of this project (progress, schedule, approved reports and photos you marked for the client), and can download the client report. Anyone with the link can open it until it expires or you withdraw it.
        </p>
        <div className="share-tabs" role="tablist" aria-label="Share method">
          {tabs.map(([k, l]) => (
            <button key={k} role="tab" id={`share-tab-${k}`} aria-controls={`share-panel-${k}`} aria-selected={tab === k} tabIndex={tab === k ? 0 : -1} className={`share-tab ${tab === k ? 'on' : ''}`}
              onClick={() => setTab(k)}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                const i = (tabs.findIndex(([t]) => t === tab) + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
                setTab(tabs[i][0]);
                setTimeout(() => document.getElementById(`share-tab-${tabs[i][0]}`)?.focus());
              }}>{l}</button>
          ))}
        </div>
        <label className="field share-days">Link expires after
          <select className="input" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {DAYS.map((d) => <option key={d} value={d}>{d === 1 ? '1 day' : `${d} days`}</option>)}
          </select>
        </label>
        <div role="tabpanel" id={`share-panel-${tab}`} aria-labelledby={`share-tab-${tab}`}>
          {tab === 'email' && <EmailTab key={projectId} projectId={projectId} projectCode={projectCode} projectName={projectName} days={days} onSent={load} />}
          {tab === 'qr' && <QrTab projectCode={projectCode} projectName={projectName} create={() => create('qr', 'QR code')} />}
          {tab === 'link' && <LinkTab create={() => create('link', 'Direct link')} />}
        </div>

        <h3 className="share-sub">Links for this project</h3>
        {listError && <p className="bad">{listError}</p>}
        {!shares ? <p className="note">Loading…</p> : !shares.length ? <div className="empty">No links yet.</div> : (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Method</th><th>Sent to / label</th><th>Created</th><th>Expires</th><th className="num">Opened</th><th>Status</th><th></th></tr></thead>
              <tbody>{shares.map((s) => {
                const st = shareState(s);
                return (
                  <tr key={s.id}>
                    <td>{s.method === 'email' ? 'Email' : s.method === 'qr' ? 'QR code' : 'Link'}</td>
                    <td>{s.recipient_email ?? s.label}</td>
                    <td className="note">{when(s.created_at)}</td>
                    <td className="note">{fmtDate(s.expires_at.slice(0, 10))}</td>
                    <td className="num" title={s.last_opened_at ? `Last opened ${when(s.last_opened_at)}` : undefined}>{s.open_count}</td>
                    <td><span className={`pill ${st === 'Active' ? 'pill-ok' : st === 'Expired' ? 'pill-warn' : 'pill-bad'}`}>{st}</span></td>
                    <td>{st === 'Active' && <button className="btn btn-sm" onClick={() => revoke(s)}>Withdraw</button>}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
        <p className="note">"Opened" counts link opens. It does not prove that a particular person read the report.</p>
      </div>
    </div>
  );
}

function EmailTab({ projectId, projectCode, projectName, days, onSent }: { projectId: string; projectCode: string; projectName: string; days: number; onSent: () => void }) {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState(defaultSubject(projectCode, projectName));
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const key = useRef(crypto.randomUUID());

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!validEmail(to)) return setResult({ ok: false, text: 'Enter a valid e-mail address.' });
    setBusy(true);
    setResult(null);
    const r = await fetch('/api/share/email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, to, subject, message, days, requestKey: key.current }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setBusy(false);
    if (!r) return setResult({ ok: false, text: 'Cannot reach the server. Nothing was sent.' });
    if (!r.ok) {
      if (r.status !== 409) key.current = crypto.randomUUID();
      return setResult({ ok: false, text: j.error ?? 'The e-mail was not sent.' });
    }
    setResult({ ok: true, text: `Gmail accepted the e-mail to ${to}. Delivery to their inbox is not confirmed. The link expires ${fmtDate(String(j.expiresAt).slice(0, 10))}.` });
    key.current = crypto.randomUUID();
    setTo('');
    setMessage('');
    onSent();
  };

  return (
    <form onSubmit={send} className="auth-form">
      <label className="field">Recipient e-mail<input className="input" type="email" autoComplete="email" required value={to} onChange={(e) => setTo(e.target.value)} placeholder="client@example.com" /></label>
      <label className="field">Subject<input className="input" maxLength={150} value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
      <label className="field">Message (optional)<textarea className="input" rows={3} maxLength={1500} value={message} onChange={(e) => setMessage(e.target.value)} /></label>
      <p className="note">Sent from the NEAS Gmail account with a secure "View report" link. No files are attached. Each e-mail gets its own link, which you can withdraw below.</p>
      {result && <p className={result.ok ? 'ok' : 'bad'} role="status">{result.text}</p>}
      <div className="form-actions"><button className="btn btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send by e-mail'}</button></div>
    </form>
  );
}

async function copy(text: string, field?: HTMLInputElement | null) {
  try {
    await navigator.clipboard.writeText(text);
    notify('Link copied.');
  } catch {
    field?.select();
    notify('Copy was blocked by the browser. The link is selected: press Ctrl+C.');
  }
}

function LinkTab({ create }: { create: () => Promise<Created | null> }) {
  const [made, setMade] = useState<Created | null>(null);
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  return (
    <div className="auth-form">
      {!made ? (
        <div className="form-actions"><button className="btn btn-primary" disabled={busy} onClick={async () => { setBusy(true); setMade(await create()); setBusy(false); }}>{busy ? 'Creating…' : 'Create link'}</button></div>
      ) : (
        <>
          <label className="field">Share link<input ref={field} className="input" readOnly value={made.url} onFocus={(e) => e.target.select()} /></label>
          <p className="note">Expires {when(made.expiresAt)}. Copy it now: for security it is not shown again.</p>
          <div className="form-actions"><button className="btn btn-primary" onClick={() => copy(made.url, field.current)}>Copy link</button><button className="btn" onClick={() => setMade(null)}>New link</button></div>
        </>
      )}
    </div>
  );
}

function QrTab({ projectCode, projectName, create }: { projectCode: string; projectName: string; create: () => Promise<Created | null> }) {
  const [made, setMade] = useState<(Created & { png: string; svg: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  const make = async () => {
    setBusy(true);
    const c = await create();
    if (c) {
      const opts = { errorCorrectionLevel: 'M' as const, margin: 2, color: { dark: '#071D29', light: '#FFFFFF' } };
      setMade({ ...c, png: await QRCode.toDataURL(c.url, { ...opts, width: 640 }), svg: await QRCode.toString(c.url, { ...opts, type: 'svg' }) });
    }
    setBusy(false);
  };
  const save = (href: string, name: string) => {
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    a.click();
  };
  const print = () => {
    if (!made) return;
    const w = window.open('', '_blank', 'width=720,height=900');
    if (!w) return notify('Pop-ups are blocked. Download the PNG and print it instead.');
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(projectCode)} QR</title>
<body style="font-family:Arial,sans-serif;text-align:center;color:#071D29;padding:32px">
<img src="${location.origin}/neas-logo.png" alt="NEAS" width="90"><h2 style="margin:12px 0 4px">${esc(projectName)}</h2>
<div style="letter-spacing:.08em;color:#CA9332;font-weight:bold">${esc(projectCode)}</div>
<img src="${made.png}" alt="QR code for the shared project report" style="width:320px;height:320px;margin:20px auto;display:block">
<p style="font-size:13px;max-width:420px;margin:0 auto">Scan with a phone camera to view the approved project report. The link expires ${esc(when(made.expiresAt))} and can be withdrawn by NEAS.</p>
<script>window.onload=function(){window.print()}</script></body>`);
    w.document.close();
  };

  if (!made) return <div className="form-actions"><button className="btn btn-primary" disabled={busy} onClick={make}>{busy ? 'Creating…' : 'Generate QR code'}</button></div>;
  return (
    <div className="share-qr">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={made.png} alt={`QR code that opens the shared report for ${projectCode}`} width={220} height={220} />
      <div className="auth-form" style={{ flex: 1, minWidth: 0 }}>
        <label className="field">Link in the QR code<input ref={field} className="input" readOnly value={made.url} onFocus={(e) => e.target.select()} /></label>
        <p className="note">Expires {when(made.expiresAt)}. Withdraw it below and the QR code stops working.</p>
        <div className="form-actions">
          <button className="btn btn-sm" onClick={() => save(made.png, `${projectCode}-report-qr.png`)}>Download PNG</button>
          <button className="btn btn-sm" onClick={() => save(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(made.svg)}`, `${projectCode}-report-qr.svg`)}>Download SVG</button>
          <button className="btn btn-sm" onClick={print}>Print QR sheet</button>
          <button className="btn btn-sm" onClick={() => copy(made.url, field.current)}>Copy link</button>
        </div>
      </div>
    </div>
  );
}
