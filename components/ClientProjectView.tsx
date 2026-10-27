'use client';
// Read-only view of the information NEAS approved for a client: used by the passcode portal
// and by shared report links. Everything shown comes from neas.approved_project_view.
import { useState, type ReactNode } from 'react';
import { Gantt, SCurve } from '@/components/Charts';
import type { ClientFile, ClientView } from '@/lib/cloud/clientView';
import { fmtDate, fmtPct } from '@/lib/format';
import EvidenceReportPanel from '@/components/EvidenceReportPanel';
import ProjectReportPanel from '@/components/ProjectReportPanel';
import { useRef } from 'react';
import { coverPhotos } from '@/lib/coverPhotos';
import { COMPANY } from '@/lib/evidenceReport';
import LocationViewer, { type LocationInfo } from '@/components/LocationViewer';
import { gpsSourceLabel, mapUrl } from '@/lib/geo';
import type { GpsSource, GpsStatus } from '@/lib/types';

export default function ClientProjectView({ view, cachedAt, footer }: { view: ClientView; cachedAt?: string | null; footer?: ReactNode }) {
  const fresh = useRef<Promise<unknown> | null>(null);
  return (
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
            <ReportGroups reports={view.reports} />
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
          preparedBy={`${COMPANY} (client copy)`}
          project={{ code: view.project.code, name: view.project.name, client: view.project.client, site: view.project.site, referenceNo: view.project.reference_no, status: view.project.status, startDate: view.project.start_date, endDate: view.project.end_date }}
          photos={view.files.filter((f) => f.mime.startsWith('image/') && f.url).map((f) => ({
            id: f.id, kind: f.kind, caption: f.caption, takenAt: f.capturedAt ?? f.createdAt, ref: f.ref, activity: f.activity, workArea: f.workArea, location: f.location, pairId: f.pairId,
            gps: f.gps ? `${f.gps.lat.toFixed(6)}, ${f.gps.lng.toFixed(6)}${f.gps.accuracy != null ? ` ±${Math.round(f.gps.accuracy)} m` : ''}` : undefined,
            gpsSource: f.gps ? gpsSourceLabel(f.gps.source as GpsSource | null, f.gps.status as GpsStatus) : undefined, mapUrl: mapUrl(f.gps?.lat, f.gps?.lng),
          }))}
          load={async (p) => {
            const url = view.files?.find((f) => f.id === p.id)?.url;
            const r = url ? await fetch(url) : null;
            return r?.ok ? r.blob() : null;
          }}
        />
      )}
      <ProjectReportPanel
        note="Contains only information NEAS has approved for you."
        load={async (id) => {
          const get = async (u?: string | null) => { const r = u ? await fetch(u).catch(() => null) : null; return r?.ok ? r.blob() : null; };
          const first = await get(view.files?.find((f) => f.id === id)?.url);
          if (first) return first;
          // photo links expire after an hour: fetch fresh ones once and try again
          if (!fresh.current) fresh.current = fetch(`/api/client/snapshot?code=${encodeURIComponent(view.project.code)}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
          const v = await fresh.current as { files?: { id: string; url: string | null }[] } | null;
          return get(v?.files?.find((f) => f.id === id)?.url);
        }}
        input={(asOf) => {
          const files = (view.files ?? []).filter((f) => f.mime.startsWith('image/') && f.url);
          const acts = (view.gantt ?? []).map((g) => ({ id: g.id, projectId: view.project.code, name: g.name, start: g.start, end: g.end, weight: g.weight }));
          return {
            audience: 'client' as const, generatedAt: new Date(), preparedBy: `${COMPANY} (client copy)`, asOf: view.asOf <= asOf ? view.asOf : asOf,
            project: { code: view.project.code, name: view.project.name, client: view.project.client, site: view.project.site, referenceNo: view.project.reference_no, status: view.project.status, startDate: view.project.start_date, endDate: view.project.end_date },
            activities: acts,
            reports: (view.gantt ?? []).map((g) => ({ id: `g-${g.id}`, projectId: view.project.code, activityId: g.id, date: view.asOf, actualPct: g.actual, notes: '', createdAt: view.generatedAt, status: 'approved' as const })),
            series: view.scurve ?? [], overall: view.progress ?? null,
            cover: coverPhotos(files.map((f) => ({ ...f, takenAt: f.capturedAt ?? f.createdAt }))).map((f) => ({
              id: f.id, caption: f.caption, category: f.coverCategory, ref: f.ref, workArea: f.workArea, location: f.location,
              lat: f.gps?.lat ?? null, lng: f.gps?.lng ?? null, accuracy: f.gps?.accuracy ?? null, source: (f.gps?.source ?? null) as GpsSource | null, status: f.gps?.status ?? null,
              takenAt: f.capturedAt ?? f.createdAt, uploadedAt: f.createdAt,
            })),
            evidence: files.filter((f) => !f.isCover && f.kind !== 'reference').map((f) => ({
              id: f.id, kind: f.kind, caption: f.caption, takenAt: f.capturedAt ?? f.createdAt, ref: f.ref, activity: f.activity, workArea: f.workArea, location: f.location, pairId: f.pairId,
              gps: f.gps ? `${f.gps.lat.toFixed(6)}, ${f.gps.lng.toFixed(6)}${f.gps.accuracy != null ? ` ±${Math.round(f.gps.accuracy)} m` : ''}` : undefined,
              gpsSource: f.gps ? gpsSourceLabel(f.gps.source as GpsSource | null, f.gps.status as GpsStatus) : undefined, mapUrl: mapUrl(f.gps?.lat, f.gps?.lng),
            })),
          };
        }}
      />
      {footer}
    </>
  );
}

type Rep = NonNullable<ClientView['reports']>[number];

/** Approved reports grouped by date: the latest day is open, older days collapse to one line each. */
function ReportGroups({ reports }: { reports: Rep[] }) {
  const days = [...new Set(reports.map((r) => r.report_date))].sort((a, b) => b.localeCompare(a));
  const [open, setOpen] = useState<Set<string>>(() => new Set(days.slice(0, 1)));
  const toggle = (d: string) => setOpen((o) => { const n = new Set(o); if (n.has(d)) n.delete(d); else n.add(d); return n; });
  return (
    <>
      <div className="grid-pager">
        <span className="note">{reports.length} report(s) on {days.length} day(s)</span>
        <button className="btn btn-sm" onClick={() => setOpen(new Set(days))}>Expand all</button>
        <button className="btn btn-sm" onClick={() => setOpen(new Set())}>Collapse all</button>
      </div>
      <div className="table-wrap">
        <table className="tbl group-tbl">
          <thead><tr><th>Date</th><th>Activity</th><th className="num">Progress</th><th>Summary</th></tr></thead>
          {days.map((d) => {
            const rows = reports.filter((r) => r.report_date === d);
            const acts = new Set(rows.map((r) => r.activity ?? '—'));
            const isOpen = open.has(d);
            return (
              <tbody key={d}>
                <tr className="group-row">
                  <td colSpan={4}>
                    <button className="group-toggle" aria-expanded={isOpen} onClick={() => toggle(d)}>
                      <span aria-hidden="true">{isOpen ? '▾' : '▸'}</span> <b>{fmtDate(d)}</b>
                      <span className="note"> · {rows.length} report(s) · {acts.size} activit{acts.size === 1 ? 'y' : 'ies'}</span>
                    </button>
                  </td>
                </tr>
                {isOpen && rows.map((r, i) => <tr key={i}><td></td><td>{r.activity ?? '—'}</td><td className="num">{r.actual_pct != null ? fmtPct(Number(r.actual_pct)) : '—'}</td><td>{r.notes}</td></tr>)}
              </tbody>
            );
          })}
        </table>
      </div>
    </>
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
