'use client';
import { useCallback, useEffect, useState } from 'react';
import { Gantt, SCurve } from '@/components/Charts';
import type { ClientView } from '@/lib/cloud/clientView';
import { fmtDate, fmtPct } from '@/lib/format';
import { normaliseProjectCode } from '@/lib/cloud/validate';
import EvidenceReportPanel from '@/components/EvidenceReportPanel';
import { COMPANY } from '@/lib/evidenceReport';
import LocationViewer, { type LocationInfo } from '@/components/LocationViewer';
import { gpsSourceLabel } from '@/lib/geo';
import type { ClientFile } from '@/lib/cloud/clientView';
import type { GpsSource, GpsStatus } from '@/lib/types';

const cacheKey = (code: string) => `neas-client-cache:${code}`;

// Client viewer portal: passcode only, read-only, approved content only.
export default function ClientPortal({ params }: { params: { code: string } }) {
  const code = normaliseProjectCode(decodeURIComponent(params.code));
  const [view, setView] = useState<ClientView | null>(null);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/client/snapshot?code=${encodeURIComponent(code)}`, { cache: 'no-store' });
      if (r.status === 401) {
        setNeedLogin(true);
        setView(null);
        return;
      }
      if (!r.ok) throw new Error('unavailable');
      const v = (await r.json()) as ClientView;
      setView(v);
      setCachedAt(null);
      setNeedLogin(false);
      try {
        // cache the summary for offline viewing (no file links: they expire)
        localStorage.setItem(cacheKey(code), JSON.stringify({ at: new Date().toISOString(), view: { ...v, files: v.files?.map((f) => ({ ...f, url: null })) } }));
      } catch { /* storage blocked */ }
    } catch {
      try {
        const c = JSON.parse(localStorage.getItem(cacheKey(code)) ?? 'null');
        if (c?.view) {
          setView(c.view);
          setCachedAt(c.at);
          return;
        }
      } catch { /* ignore */ }
      setError('Cannot reach the server. Check your connection.');
    }
  }, [code]);

  useEffect(() => {
    void load();
  }, [load]);

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await fetch('/api/client/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, passcode }) }).catch(() => null);
    setBusy(false);
    if (!r) return setError('Cannot reach the server. Check your connection.');
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return setError(j.error ?? 'Could not sign in.');
    setPasscode('');
    await load();
  };

  const logout = async () => {
    await fetch('/api/client/logout', { method: 'POST' }).catch(() => undefined);
    try { localStorage.removeItem(cacheKey(code)); } catch { /* ignore */ }
    setView(null);
    setNeedLogin(true);
  };

  return (
    <div className="client-shell">
      <header className="client-top">
        <div className="auth-brand">
          <span className="brand-mark">NE</span>
          <span><div className="auth-brand-name">NEXTEDGE ACCESS SOLUTIONS</div><div className="brand-sub">CLIENT PROJECT VIEW</div></span>
        </div>
        {view && !cachedAt && <button className="btn btn-sm" onClick={logout}>Sign out</button>}
      </header>

      <main className="client-main">
        {needLogin && !view && (
          <section className="card client-login">
            <h1>Project {code}</h1>
            <p className="lead">Enter the passcode NEAS gave you. This is a read-only view of approved project information.</p>
            <form onSubmit={login} className="auth-form">
              <label className="field">Passcode<input id="client-passcode" className="input" autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} placeholder="XXXX-XXXX-XXXX" value={passcode} onChange={(e) => setPasscode(e.target.value)} /></label>
              {error && <p className="bad" role="alert">{error}</p>}
              <button className="btn btn-primary" disabled={busy || passcode.replace(/[^A-Za-z0-9]/g, '').length < 8}>{busy ? 'Checking…' : 'View project'}</button>
            </form>
            <p className="note">Lost the passcode or it stopped working? Contact your NEAS project manager for a new one.</p>
          </section>
        )}

        {!needLogin && !view && <div className="card note">{error ?? 'Loading…'}</div>}

        {view && (
          <>
            {cachedAt && <div className="banner">Offline copy saved {new Date(cachedAt).toLocaleString()}. It may be out of date. Reconnect to see the latest approved information.</div>}
            <section className="card">
              <div className="eyebrow">{view.project.code}</div>
              <h1 style={{ margin: '4px 0' }}>{view.project.name}</h1>
              <div className="client-meta">
                {view.project.client && <span>Client: <b>{view.project.client}</b></span>}
                {view.project.site && <span>Site: <b>{view.project.site}</b></span>}
                {view.project.start_date && <span>Schedule: <b>{fmtDate(view.project.start_date)} – {fmtDate(view.project.end_date)}</b></span>}
                <span>Status: <b>{view.project.status}</b></span>
              </div>
              <p className="note">Information approved by NEAS as of {fmtDate(view.asOf)} · updated {new Date(view.generatedAt).toLocaleString()}</p>
            </section>

            {(view.progress || view.completion) && (
              <section className="grid kpis">
                {view.progress && <div className="card"><div className="kpi-label">Overall progress</div><div className="kpi-val">{fmtPct(view.progress.actual)}</div><div className="bar"><span style={{ width: `${view.progress.actual}%` }} /></div></div>}
                {view.progress && <div className="card"><div className="kpi-label">Planned by today</div><div className="kpi-val">{fmtPct(view.progress.planned)}</div><div className="kpi-sub">From the approved schedule</div></div>}
                {view.completion && <div className="card"><div className="kpi-label">Completion</div><div className="kpi-val">{view.completion.complete ? 'Complete' : 'In progress'}</div></div>}
              </section>
            )}

            {view.milestones && view.milestones.length > 0 && (
              <section className="card">
                <div className="card-head"><h2>Milestones</h2></div>
                <table className="tbl"><tbody>
                  {view.milestones.map((m) => <tr key={m.name}><td>{m.name}</td><td>{fmtDate(m.date)}</td><td>{m.done ? <span className="pill pill-ok">Done</span> : <span className="pill">Upcoming</span>}</td></tr>)}
                </tbody></table>
              </section>
            )}

            {view.scurve && view.scurve.length > 0 && (
              <section className="card">
                <div className="card-head"><h2>Progress S-curve</h2><div className="legend"><span><i style={{ background: 'var(--planned)' }} />Planned</span><span><i style={{ background: 'var(--gold)' }} />Actual (approved)</span></div></div>
                <SCurve series={view.scurve} asOf={view.asOf} />
              </section>
            )}

            {view.gantt && view.gantt.length > 0 && (
              <section className="card">
                <div className="card-head"><h2>Schedule</h2></div>
                <Gantt rows={view.gantt.map((g) => ({ id: g.id, projectId: view.project.code, name: g.name, start: g.start, end: g.end, weight: g.weight }))} asOf={view.asOf} actualOf={(id) => view.gantt!.find((g) => g.id === id)?.actual ?? 0} />
              </section>
            )}

            {view.reports && (
              <section className="card">
                <div className="card-head"><h2>Progress reports</h2></div>
                {!view.reports.length ? <div className="empty">No approved reports yet.</div> : (
                  <table className="tbl">
                    <thead><tr><th>Date</th><th>Activity</th><th className="num">Progress</th><th>Summary</th></tr></thead>
                    <tbody>{view.reports.map((r, i) => <tr key={i}><td>{fmtDate(r.report_date)}</td><td>{r.activity ?? '—'}</td><td className="num">{r.actual_pct != null ? fmtPct(Number(r.actual_pct)) : '—'}</td><td>{r.notes}</td></tr>)}</tbody>
                  </table>
                )}
              </section>
            )}

            {view.files && (
              <section className="card">
                <div className="card-head"><h2>Photos and documents</h2></div>
                {!view.files.length ? <div className="empty">Nothing approved for viewing yet.</div> : (
                  <ClientGallery files={view.files} project={view.project} />
                )}
              </section>
            )}
            {view.files && view.files.some((f) => f.mime.startsWith('image/') && f.url) && (
              <EvidenceReportPanel
                audience="client"
                datesAre={view.files.every((f) => f.capturedAt) ? 'captured' : 'uploaded'}
                preparedBy={`${COMPANY} (client portal copy)`}
                project={{ code: view.project.code, name: view.project.name, client: view.project.client, site: view.project.site, referenceNo: view.project.reference_no, status: view.project.status, startDate: view.project.start_date, endDate: view.project.end_date }}
                photos={view.files.filter((f) => f.mime.startsWith('image/') && f.url).map((f) => ({
                  id: f.id, kind: f.kind, caption: f.caption, takenAt: f.capturedAt ?? f.createdAt, ref: f.ref, activity: f.activity, workArea: f.workArea, location: f.location, pairId: f.pairId,
                  gps: f.gps ? `${f.gps.lat.toFixed(6)}, ${f.gps.lng.toFixed(6)}${f.gps.accuracy != null ? ` ±${Math.round(f.gps.accuracy)} m` : ''}` : undefined,
                  gpsSource: f.gps ? gpsSourceLabel(f.gps.source as GpsSource | null, f.gps.status as GpsStatus) : undefined,
                }))}
                load={async (p) => {
                  const url = view.files?.find((f) => f.id === p.id)?.url;
                  const r = url ? await fetch(url) : null;
                  return r?.ok ? r.blob() : null;
                }}
              />
            )}
            <p className="note" style={{ textAlign: 'center' }}>Read-only view · session ends {new Date(view.sessionExpiresAt).toLocaleString()}</p>
          </>
        )}
      </main>
    </div>
  );
}

/** Approved photos in a fixed 2 × 4 or 2 × 6 grid; location details when the project shares them. */
function ClientGallery({ files, project }: { files: ClientFile[]; project: ClientView['project'] }) {
  const [layout, setLayout] = useState<'2x4' | '2x6'>('2x4');
  const [page, setPage] = useState(0);
  const [loc, setLoc] = useState<LocationInfo | null>(null);
  const per = layout === '2x6' ? 12 : 8;
  const pages = Math.max(1, Math.ceil(files.length / per));
  const pg = Math.min(page, pages - 1);
  const items = files.slice(pg * per, (pg + 1) * per);
  const when = (s: string) => new Date(s).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const pager = pages > 1 && (
    <div className="grid-pager">
      <button className="btn btn-sm" disabled={pg === 0} onClick={() => setPage(pg - 1)}>‹ Previous</button>
      <span className="note">Page {pg + 1} of {pages}</span>
      <button className="btn btn-sm" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)}>Next ›</button>
    </div>
  );
  return (
    <>
      <div className="grid-pager">
        <label className="note" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>Layout
          <select className="input" style={{ width: 'auto' }} value={layout} onChange={(e) => { setLayout(e.target.value as '2x4' | '2x6'); setPage(0); }}>
            <option value="2x4">2 × 4</option><option value="2x6">2 × 6</option>
          </select>
        </label>
        <span className="note">{files.length} approved item(s)</span>
      </div>
      {pager}
      <div className={`evidence-grid layout-${layout}`}>
        {items.map((f) => (
          <figure key={f.id} className="photo" style={{ margin: 0 }}>
            {f.mime.startsWith('image/') && f.url
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={f.url} alt={f.caption || f.kind} />
              : <div className="thumb-missing">{f.url ? <a href={f.url} target="_blank" rel="noreferrer">Open document</a> : 'Photo not available offline'}</div>}
            <figcaption className="meta">
              <span><span className="pill">{f.kind}</span> {f.ref && <b>{f.ref}</b>}</span>
              {(f.activity || f.workArea) && <span>{[f.activity, f.workArea].filter(Boolean).join(' · ')}</span>}
              {f.caption && <span>{f.caption}</span>}
              <span className="note">{f.capturedAt ? `Captured ${when(f.capturedAt)}` : `Uploaded ${when(f.createdAt)}`}</span>
              {f.gps
                ? <span className="note">📍 {f.gps.lat.toFixed(6)}, {f.gps.lng.toFixed(6)}{f.gps.accuracy != null ? ` ±${Math.round(f.gps.accuracy)} m` : ''} <button className="btn btn-sm" style={{ padding: '0 6px' }} onClick={() => setLoc({
                    ref: f.ref, projectName: project.name, projectCode: project.code, client: project.client, site: project.site, workArea: f.workArea, location: f.location,
                    lat: f.gps!.lat, lng: f.gps!.lng, accuracy: f.gps!.accuracy, source: f.gps!.source as GpsSource | null, status: f.gps!.status as GpsStatus,
                    gpsAt: f.gps!.at, capturedAt: f.capturedAt, uploadedAt: f.createdAt,
                  })}>View location</button></span>
                : f.mime.startsWith('image/') && <span className="note">📍 GPS unavailable</span>}
            </figcaption>
          </figure>
        ))}
        {items.length % 2 === 1 && <div className="slot-empty" aria-hidden="true"><div className="slot-box">No further approved evidence</div></div>}
      </div>
      {pager}
      {loc && <LocationViewer info={loc} onClose={() => setLoc(null)} />}
    </>
  );
}
