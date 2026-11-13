'use client';
// Phone layouts for the Projects and Reports lists: search, filter chips, progress bars and status badges.
// Shown only on narrow screens; the full tables stay for tablets and desktops.
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useStore } from '@/lib/store';
import { projectProgress, todayLocal } from '@/lib/calc';
import { fmtDate, fmtPct } from '@/lib/format';
import { reportNo } from '@/lib/fieldReportPdf';

/** Actual % complete of every project, from its activities and approved reports. */
export function useProjectProgress() {
  const { state } = useStore();
  return useMemo(() => {
    const day = todayLocal();
    return new Map(state.projects.map((p) => {
      const acts = state.activities.filter((a) => a.projectId === p.id);
      const reps = state.reports.filter((r) => r.projectId === p.id);
      return [p.id, acts.length ? projectProgress(acts, reps, day, (id) => state.calendars?.[id]).actual : null] as const;
    }));
  }, [state.projects, state.activities, state.reports, state.calendars]);
}

export function MobileProjects() {
  const { state, setActiveProject } = useStore();
  const prog = useProjectProgress();
  const [q, setQ] = useState('');
  const [f, setF] = useState<'all' | 'active' | 'completed'>('all');
  const t = q.trim().toLowerCase();
  const list = state.projects.filter((p) => (f === 'all' || p.status === f) && (!t || `${p.code ?? ''} ${p.name} ${p.client} ${p.site}`.toLowerCase().includes(t)));
  const count = (s: string) => state.projects.filter((p) => p.status === s).length;
  return (
    <section className="m-list mobile-only" aria-label="Projects">
      <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search projects…" aria-label="Search projects" />
      <div className="m-chips">
        <button type="button" className={f === 'all' ? 'on' : ''} onClick={() => setF('all')}>All ({state.projects.length})</button>
        <button type="button" className={f === 'active' ? 'on' : ''} onClick={() => setF('active')}>In progress ({count('active')})</button>
        <button type="button" className={f === 'completed' ? 'on' : ''} onClick={() => setF('completed')}>Completed ({count('completed')})</button>
      </div>
      <ul>
        {list.map((p) => {
          const v = prog.get(p.id);
          return (
            <li key={p.id}>
              <Link href="/" onClick={() => setActiveProject(p.id)}>
                <b>{p.name}</b>
                <span className="note">{p.code} · {p.site || p.client}</span>
                {v != null && <span className="m-bar" aria-label={`${fmtPct(v)} complete`}><i style={{ width: `${Math.min(100, v)}%` }} /></span>}
              </Link>
              <span className="m-pct">{v != null ? fmtPct(v) : '—'}</span>
            </li>
          );
        })}
        {!list.length && <li className="empty">No projects match.</li>}
      </ul>
    </section>
  );
}

const TONE: Record<string, string> = { approved: 'pill-ok', submitted: 'pill-info', draft: 'pill-warn', rejected: 'pill-bad' };
const LABEL: Record<string, string> = { approved: 'Approved', submitted: 'For review', draft: 'Draft', rejected: 'Returned' };

export function MobileReports({ projectId }: { projectId: string }) {
  const { state } = useStore();
  const [q, setQ] = useState('');
  const [f, setF] = useState('');
  const [type, setType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const all = state.reports.filter((r) => r.projectId === projectId).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const act = (id: string) => state.activities.find((a) => a.id === id)?.name ?? '';
  const t = q.trim().toLowerCase();
  const list = all.filter((r) => (!f || (r.status ?? 'approved') === f) && (!type || (r.details?.type ?? 'Progress') === type)
    && (!from || r.date >= from) && (!to || r.date <= to) && (!t || `${reportNo(r)} ${act(r.activityId)} ${r.notes}`.toLowerCase().includes(t)));
  const count = (s: string) => all.filter((r) => (r.status ?? 'approved') === s).length;
  return (
    <section className="m-list mobile-only" aria-label="Reports">
      <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search reports…" aria-label="Search reports" />
      <div className="m-filters">
        <select className="input" value={type} onChange={(e) => setType(e.target.value)} aria-label="Report type"><option value="">All types</option>{['Progress', 'Inspection', 'Issue', 'Other'].map((x) => <option key={x}>{x}</option>)}</select>
        <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
        <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
      </div>
      <div className="m-chips">
        <button type="button" className={!f ? 'on' : ''} onClick={() => setF('')}>All ({all.length})</button>
        {['submitted', 'approved', 'rejected', 'draft'].filter((s) => count(s)).map((s) => <button key={s} type="button" className={f === s ? 'on' : ''} onClick={() => setF(s)}>{LABEL[s]} ({count(s)})</button>)}
      </div>
      <ul>
        {list.map((r) => {
          const st = r.status ?? 'approved';
          return (
            <li key={r.id}>
              <div>
                <b>{r.details?.description?.slice(0, 70) || act(r.activityId) || 'Field report'}</b>
                <span className="note">{reportNo(r)} · {act(r.activityId)}</span>
                <span className="note">{fmtDate(r.date)}{r.actualPct != null ? ` · ${fmtPct(r.actualPct)}` : ''}</span>
              </div>
              <span className={`pill ${TONE[st] ?? ''}`}>{LABEL[st] ?? st}</span>
            </li>
          );
        })}
        {!list.length && <li className="empty">No reports match.</li>}
      </ul>
    </section>
  );
}
