'use client';
// Global reports: every report this user may see across projects (RLS decides), with counts,
// charts, a searchable library, sharing and an activity feed. Nothing here is estimated.
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { CLOUD } from '@/lib/cloud/env';
import { supabaseBrowser } from '@/lib/cloud/browser';
import { canManage, useCloudStatus } from '@/lib/cloud/cloudSync';
import { todayLocal, addDays } from '@/lib/calc';
import { fmtDate } from '@/lib/format';
import ShareDialog from '@/components/ShareDialog';
import { countBy, dayRange, KIND_LABEL, kpis, localDay, perDay, perMonth, STATUS_LABEL, type ReportRow, type ShareRow } from '@/lib/reportStats';

type Ev = { at: string; text: string; ref: string; who: string | null };
type DbField = { id: string; project_id: string; activity_id: string | null; report_type: string; report_date: string; status: string; submitted_by: string | null; reviewed_by?: string | null; reviewed_at?: string | null; created_at: string; updated_at: string };
type DbExport = { id: string; project_id: string; report_ref: string; file_format: string; period_to: string | null; generated_by: string | null; generated_at: string };
type DbEvent = { share_id: string; project_id: string; at: string; actor_id: string | null; event: string; detail: Record<string, string> };

const PAGE = 15;
const RANGES = [7, 30, 90] as const;

export default function GlobalReports() {
  const { ready, state, setActiveProject } = useStore();
  useCloudStatus();
  const today = todayLocal();
  const [field, setField] = useState<DbField[] | null>(null);
  const [exportsRows, setExports] = useState<DbExport[]>([]);
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [events, setEvents] = useState<DbEvent[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<number | 'custom'>(30);
  const [from, setFrom] = useState(addDays(today, -29));
  const [to, setTo] = useState(today);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [fKind, setFKind] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fProject, setFProject] = useState('');
  const [sort, setSort] = useState<{ key: 'createdAt' | 'updatedAt' | 'projectCode' | 'status'; dir: 1 | -1 }>({ key: 'createdAt', dir: -1 });
  const [page, setPage] = useState(0);
  const [groupBy, setGroupBy] = useState<'' | 'project' | 'day' | 'kind' | 'status'>('project');
  const [openGroups, setOpenGroups] = useState<Set<string> | null>(null);
  const [share, setShare] = useState<{ id: string; code: string; name: string } | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim().toLowerCase()), 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => { setPage(0); }, [debounced, fKind, fStatus, fProject, sort, groupBy]);
  useEffect(() => { setOpenGroups(null); }, [groupBy]);

  useEffect(() => {
    if (!CLOUD) {
      setField(state.reports.map((r) => ({ id: r.id, project_id: r.projectId, activity_id: r.activityId, report_type: 'progress', report_date: r.date, status: r.status ?? 'approved', submitted_by: null, created_at: r.createdAt, updated_at: r.createdAt })));
      return;
    }
    const sb = supabaseBrowser()!;
    Promise.all([
      sb.from('project_reports').select('id, project_id, activity_id, report_type, report_date, status, submitted_by, reviewed_by, reviewed_at, created_at, updated_at').is('deleted_at', null).order('created_at', { ascending: false }).limit(2000),
      sb.from('project_report_exports').select('id, project_id, report_ref, file_format, period_to, generated_by, generated_at').order('generated_at', { ascending: false }).limit(2000),
      sb.from('report_shares').select('id, project_id, method, created_at, expires_at, revoked_at').limit(2000),
      sb.from('report_share_events').select('share_id, project_id, at, actor_id, event, detail').order('at', { ascending: false }).limit(300),
      sb.from('profiles').select('id, full_name, email'),
    ]).then(([f, x, s, e, p]) => {
      if (f.error || x.error) setError('Some reports could not be loaded. Counts may be incomplete; reload to try again.');
      setField((f.data as DbField[]) ?? []);
      setExports((x.data as DbExport[]) ?? []);
      setShares((s.data as ShareRow[]) ?? []);
      setEvents((e.data as DbEvent[]) ?? []);
      setNames(new Map(((p.data as { id: string; full_name: string; email: string }[]) ?? []).map((u) => [u.id, u.full_name || u.email])));
    });
  }, [reload, state.reports]);

  const proj = useMemo(() => new Map(state.projects.map((p) => [p.id, p])), [state.projects]);
  const actName = useMemo(() => new Map(state.activities.map((a) => [a.id, a.name])), [state.activities]);
  const rows: ReportRow[] = useMemo(() => [
    ...(field ?? []).map((r) => ({
      id: r.id, kind: 'field' as const, ref: `FR-${r.id.slice(0, 8).toUpperCase()}`, title: `${(r.activity_id && actName.get(r.activity_id)) || r.report_type} · ${fmtDate(r.report_date)}`,
      projectId: r.project_id, projectCode: proj.get(r.project_id)?.code ?? '—', createdBy: r.submitted_by, createdAt: r.created_at, updatedAt: r.updated_at, status: r.status, format: 'record',
    })),
    ...exportsRows.map((x) => ({
      id: x.id, kind: 'project' as const, ref: x.report_ref, title: `Project report${x.period_to ? ` as of ${fmtDate(x.period_to)}` : ''}`,
      projectId: x.project_id, projectCode: proj.get(x.project_id)?.code ?? '—', createdBy: x.generated_by, createdAt: x.generated_at, updatedAt: x.generated_at, status: 'generated', format: x.file_format.toUpperCase(),
    })),
  ], [field, exportsRows, proj, actName]);

  const activeIds = useMemo(() => new Set(state.projects.filter((p) => p.status === 'active').map((p) => p.id)), [state.projects]);
  const k = useMemo(() => kpis(rows, shares, activeIds, today), [rows, shares, activeIds, today]);
  const span = range === 'custom' ? { from: from <= to ? from : to, to: from <= to ? to : from } : { from: addDays(today, -(range - 1)), to: today };
  const inRange = rows.filter((r) => { const d = localDay(r.createdAt); return d >= span.from && d <= span.to; });
  const days = dayRange(span.from, span.to);
  const shareEvents = events.filter((e) => { const d = localDay(e.at); return d >= span.from && d <= span.to; });

  const filtered = rows
    .filter((r) => (!fKind || r.kind === fKind) && (!fStatus || r.status === fStatus) && (!fProject || r.projectId === fProject))
    .filter((r) => !debounced || `${r.ref} ${r.title} ${r.projectCode} ${proj.get(r.projectId)?.name ?? ''} ${names.get(r.createdBy ?? '') ?? ''}`.toLowerCase().includes(debounced))
    .sort((a, b) => sort.dir * String(a[sort.key]).localeCompare(String(b[sort.key])));
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const pg = Math.min(page, pages - 1);
  const shownShares = (pid: string) => shares.filter((s) => s.project_id === pid && !s.revoked_at && Date.parse(s.expires_at) > Date.now()).length;

  const groupKey = (r: ReportRow): [string, string] =>
    groupBy === 'project' ? [r.projectId, [r.projectCode !== '—' ? r.projectCode : '', proj.get(r.projectId)?.name ?? ''].filter(Boolean).join(' · ') || 'No project']
      : groupBy === 'day' ? [localDay(r.createdAt), fmtDate(localDay(r.createdAt))]
      : groupBy === 'kind' ? [r.kind, KIND_LABEL[r.kind]]
      : [r.status, STATUS_LABEL[r.status] ?? r.status];
  const groups: [string, string, ReportRow[]][] = [];
  if (groupBy) {
    const m = new Map<string, [string, string, ReportRow[]]>();
    for (const r of filtered) { const [k, l] = groupKey(r); if (!m.has(k)) m.set(k, [k, l, []]); m.get(k)![2].push(r); }
    groups.push(...m.values());
  }
  // first group open by default; the rest collapse to one line each
  const groupOpen = (k: string) => (openGroups ? openGroups.has(k) : groups[0]?.[0] === k);
  const toggleGroup = (k: string) => setOpenGroups((o) => {
    const n = new Set(o ?? (groups[0] ? [groups[0][0]] : []));
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });
  const row = (r: ReportRow) => {
    const p = proj.get(r.projectId);
    const n = shownShares(r.projectId);
    return (
      <tr key={`${r.kind}:${r.id}`}>
        <td className="mono">{r.ref}</td>
        <td className="clip" title={r.title}>{r.title}</td>
        <td className="nowrap">{r.kind === 'field' ? 'Field' : `Project · ${r.format}`}</td>
        <td className="nowrap" title={p?.name}>{r.projectCode}</td>
        <td className="clip" title={names.get(r.createdBy ?? '') ?? ''}>{names.get(r.createdBy ?? '') ?? '—'}</td>
        <td className="note nowrap">{new Date(r.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</td>
        <td><span className={`pill ${r.status === 'approved' ? 'pill-ok' : r.status === 'submitted' || r.status === 'draft' ? 'pill-warn' : r.status === 'rejected' ? 'pill-bad' : ''}`}>{STATUS_LABEL[r.status] ?? r.status}</span></td>
        <td className="note nowrap" title={n ? `${n} active link(s) for this project` : undefined}>{n ? `${n} link(s)` : '—'}</td>
        <td className="note nowrap">{fmtDate(localDay(r.updatedAt))}</td>
        <td className="row-actions">
          <Link className="btn btn-sm" href={r.kind === 'field' ? '/field-reports' : `/reports?project=${r.projectId}`} onClick={() => setActiveProject(r.projectId)}>View</Link>
          {CLOUD && p && canManage(r.projectId) && <button className="btn btn-sm" onClick={() => setShare({ id: p.id, code: p.code ?? p.id, name: p.name })}>Share</button>}
        </td>
      </tr>
    );
  };

  const feed: Ev[] = useMemo(() => {
    const who = (id: string | null | undefined) => (id ? names.get(id) ?? null : null);
    const code = (pid: string) => proj.get(pid)?.code ?? '—';
    const out: Ev[] = [];
    for (const r of field ?? []) {
      out.push({ at: r.created_at, text: `Field report ${r.status === 'draft' ? 'drafted' : 'submitted'}`, ref: `${code(r.project_id)} · FR-${r.id.slice(0, 8).toUpperCase()}`, who: who(r.submitted_by) });
      if (r.reviewed_at && (r.status === 'approved' || r.status === 'rejected')) out.push({ at: r.reviewed_at, text: `Field report ${r.status}`, ref: `${code(r.project_id)} · FR-${r.id.slice(0, 8).toUpperCase()}`, who: who(r.reviewed_by) });
    }
    for (const x of exportsRows) out.push({ at: x.generated_at, text: 'Project report generated', ref: `${code(x.project_id)} · ${x.report_ref}`, who: who(x.generated_by) });
    const label: Record<string, string> = { created: 'Share link created', revoked: 'Share link withdrawn', opened: 'Shared link opened', email_sent: 'E-mail accepted by Gmail', email_failed: 'E-mail failed (not sent)' };
    for (const e of events) out.push({ at: e.at, text: `${label[e.event] ?? e.event}${e.detail?.to ? ` · ${e.detail.to}` : e.detail?.method ? ` · ${e.detail.method}` : ''}`, ref: code(e.project_id), who: e.event === 'opened' ? null : who(e.actor_id) });
    return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40);
  }, [field, exportsRows, events, names, proj]);

  if (!ready || field === null) return <div className="card note">Loading reports…</div>;

  const pick = (kind = '', status = '') => {
    setFKind(kind);
    setFStatus(status);
    setTimeout(() => document.getElementById('report-library')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  const cards: { label: string; value: number; sub: string; go: () => void }[] = [
    { label: 'Total reports', value: k.total, sub: `${rows.filter((r) => r.kind === 'field').length} field · ${rows.filter((r) => r.kind === 'project').length} project reports`, go: () => pick() },
    { label: 'Created today', value: k.today, sub: fmtDate(today), go: () => pick() },
    { label: 'This month', value: k.month, sub: 'Since the 1st, local time', go: () => pick() },
    { label: 'Pending review', value: k.pending, sub: 'Submitted field reports', go: () => pick('field', 'submitted') },
    { label: 'Approved', value: k.approved, sub: 'Approved field reports', go: () => pick('field', 'approved') },
    { label: 'Needs attention', value: k.needsAttention, sub: 'Rejected or still draft', go: () => pick('field', 'rejected') },
    { label: 'Projects shared', value: k.sharedProjects, sub: 'With an active share link', go: () => document.getElementById('report-activity')?.scrollIntoView({ behavior: 'smooth' }) },
    { label: 'Active projects covered', value: k.activeCovered, sub: `of ${activeIds.size} active project(s)`, go: () => pick() },
  ];
  const sortBtn = (key: typeof sort.key, label: string) => (
    <button className="linklike th-sort" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : -1 }))} aria-label={`Sort by ${label}`}>
      {label}{sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
    </button>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Reporting intelligence</div>
          <h1>Global reports</h1>
          <p className="lead">Every field report and generated project report you have access to, across all projects, with review status and sharing.</p>
        </div>
        <div className="form-actions" style={{ marginTop: 0 }}>
          <button className="btn" onClick={() => setReload((n) => n + 1)}>Refresh</button>
          <Link className="btn btn-primary" href="/reports">Generate a project report</Link>
        </div>
      </div>
      {error && <div className="banner" role="alert">{error}</div>}

      <div className="grid kpis kpis-4">
        {cards.map((c) => (
          <button key={c.label} className="card kpi-link kpi-btn" onClick={c.go}>
            <div className="kpi-label">{c.label}</div>
            <div className="kpi-val">{c.value}</div>
            <div className="kpi-sub">{c.sub}</div>
          </button>
        ))}
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Report activity</h2>
          <div className="form-actions" style={{ marginTop: 0 }}>
            <label className="note range-pick">Period
              <select className="input" value={range} onChange={(e) => setRange(e.target.value === 'custom' ? 'custom' : Number(e.target.value))}>
                {RANGES.map((r) => <option key={r} value={r}>Last {r} days</option>)}
                <option value="custom">Custom range</option>
              </select>
            </label>
            {range === 'custom' && <>
              <label className="note range-pick">From<input className="input" type="date" value={from} max={today} onChange={(e) => setFrom(e.target.value)} /></label>
              <label className="note range-pick">To<input className="input" type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} /></label>
            </>}
          </div>
        </div>
        <p className="note">{inRange.length} report(s) created {fmtDate(span.from)} – {fmtDate(span.to)}.</p>
        <div className="chart-grid">
          <BarChart title="Reports created per day" data={perDay(inRange, days)} dense />
          <BarChart title="Monthly trend (last 6 months)" data={perMonth(rows, 6, today)} />
          <BarChart title="By report type" data={countBy(inRange, (r) => KIND_LABEL[r.kind])} horizontal />
          <BarChart title="By status" data={countBy(inRange, (r) => STATUS_LABEL[r.status] ?? r.status)} horizontal />
          <BarChart title="By project (top 8)" data={countBy(inRange, (r) => r.projectCode).slice(0, 8)} horizontal />
          <BarChart title="Sharing in this period" data={countBy(shareEvents.filter((e) => e.event === 'created'), (e) => ({ link: 'Direct link', qr: 'QR code', email: 'E-mail' } as Record<string, string>)[e.detail?.method] ?? 'Other')} horizontal empty="No links created in this period." />
        </div>
      </section>

      <section className="card" id="report-library">
        <div className="card-head"><h2>Report library</h2>
          <div className="form-actions" style={{ marginTop: 0 }}>
            <span className="note">{filtered.length} of {rows.length} report(s){groupBy ? ` in ${groups.length} group(s)` : ''}</span>
            {groupBy && <><button className="btn btn-sm" onClick={() => setOpenGroups(new Set(groups.map((g) => g[0])))}>Expand all</button><button className="btn btn-sm" onClick={() => setOpenGroups(new Set())}>Collapse all</button></>}
          </div>
        </div>
        <div className="filters">
          <input className="input" type="search" placeholder="Search reference, title, project or person" aria-label="Search reports" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input" aria-label="Report type" value={fKind} onChange={(e) => setFKind(e.target.value)}><option value="">All types</option><option value="field">Field reports</option><option value="project">Project reports (PDF)</option></select>
          <select className="input" aria-label="Status" value={fStatus} onChange={(e) => setFStatus(e.target.value)}><option value="">All statuses</option>{Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <select className="input" aria-label="Project" value={fProject} onChange={(e) => setFProject(e.target.value)}><option value="">All projects</option>{state.projects.map((p) => <option key={p.id} value={p.id}>{p.code ?? p.name} · {p.name}</option>)}</select>
          <select className="input" aria-label="Group by" value={groupBy} onChange={(e) => setGroupBy(e.target.value as typeof groupBy)}>
            <option value="project">Group by project</option><option value="day">Group by date</option><option value="kind">Group by type</option><option value="status">Group by status</option><option value="">No grouping</option>
          </select>
          {(q || fKind || fStatus || fProject) && <button className="btn btn-sm" onClick={() => { setQ(''); setFKind(''); setFStatus(''); setFProject(''); }}>Clear</button>}
        </div>
        {!filtered.length ? <div className="empty">{rows.length ? 'No reports match these filters.' : 'No reports yet. Field reports and generated project reports appear here.'}</div> : (
          <div className="table-wrap">
            <table className="tbl report-tbl">
              <thead><tr>
                <th>Reference</th><th>Title</th><th>Type</th><th>{sortBtn('projectCode', 'Project')}</th><th>Created by</th><th>{sortBtn('createdAt', 'Created')}</th><th>{sortBtn('status', 'Status')}</th><th>Sharing</th><th>{sortBtn('updatedAt', 'Updated')}</th><th>Actions</th>
              </tr></thead>
              {groupBy ? groups.map(([key, label, items]) => {
                const isOpen = groupOpen(key);
                return (
                  <tbody key={key}>
                    <tr className="group-row"><td colSpan={10}>
                      <button className="group-toggle" aria-expanded={isOpen} onClick={() => toggleGroup(key)}>
                        <span aria-hidden="true">{isOpen ? '▾' : '▸'}</span> <b>{label}</b><span className="note"> · {items.length} report(s)</span>
                      </button>
                    </td></tr>
                    {isOpen && items.map(row)}
                  </tbody>
                );
              }) : <tbody>{filtered.slice(pg * PAGE, (pg + 1) * PAGE).map(row)}</tbody>}
            </table>
          </div>
        )}
        {!groupBy && pages > 1 && (
          <div className="grid-pager">
            <button className="btn btn-sm" disabled={pg === 0} onClick={() => setPage(pg - 1)}>‹ Previous</button>
            <span className="note">Page {pg + 1} of {pages}</span>
            <button className="btn btn-sm" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)}>Next ›</button>
          </div>
        )}
        <p className="note">Shares cover a project&apos;s approved client view, so the sharing column counts the project&apos;s active links. Generated PDFs are rebuilt on demand from current data; open them from Project reports.</p>
      </section>

      <section className="card" id="report-activity">
        <div className="card-head"><h2>Activity</h2><span className="note">Latest 40 events you can see</span></div>
        {!feed.length ? <div className="empty">No report activity yet.</div> : (
          <ul className="feed">
            {feed.map((e, i) => (
              <li key={i}><time className="note" dateTime={e.at}>{new Date(e.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time><span><b>{e.text}</b> <span className="note">{e.ref}{e.who ? ` · ${e.who}` : ''}</span></span></li>
            ))}
          </ul>
        )}
        <p className="note">A link opening is not proof that a particular person read the report. E-mail &quot;accepted&quot; means Gmail took the message; inbox delivery is not confirmed.</p>
      </section>
      {share && <ShareDialog projectId={share.id} projectCode={share.code} projectName={share.name} onClose={() => { setShare(null); setReload((n) => n + 1); }} />}
    </>
  );
}

/** Small accessible bar chart with a table alternative. */
function BarChart({ title, data, horizontal, dense, empty = 'No reports in this period.' }: { title: string; data: { label: string; value: number }[]; horizontal?: boolean; dense?: boolean; empty?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <figure className="mini-chart">
      <figcaption>{title}</figcaption>
      {!total ? <div className="empty">{empty}</div> : horizontal ? (
        <div className="hbars" aria-hidden="true">
          {data.map((d) => (
            <div key={d.label} className="hbar"><span className="hbar-label">{d.label}</span><span className="hbar-track"><span style={{ width: `${(d.value / max) * 100}%` }} /></span><b>{d.value}</b></div>
          ))}
        </div>
      ) : (
        <div className={`vbars ${dense ? 'dense' : ''}`} aria-hidden="true">
          {data.map((d) => (
            <div key={d.label} className="vbar" title={`${d.label}: ${d.value}`}><span style={{ height: `${(d.value / max) * 100}%` }} /><small>{dense ? d.label.slice(8) : d.label.slice(2)}</small></div>
          ))}
        </div>
      )}
      {total > 0 && (
        <details className="chart-table">
          <summary>Show as table</summary>
          <table className="tbl"><tbody>{data.filter((d) => d.value || !dense).map((d) => <tr key={d.label}><td>{d.label}</td><td className="num">{d.value}</td></tr>)}</tbody></table>
        </details>
      )}
    </figure>
  );
}
