'use client';
// Portfolio KPIs and a prioritised action list across every project this user can see.
// Everything is counted from the loaded records; nothing is estimated or invented.
import Link from 'next/link';
import { useMemo } from 'react';
import { useStore } from '@/lib/store';
import { projectProgress, todayLocal, addDays } from '@/lib/calc';
import { calendarOf, scopeMetrics } from '@/lib/schedule';
import { fmtDate, fmtPct } from '@/lib/format';

type Action = { key: string; tone: 'bad' | 'warn' | 'info'; title: string; detail: string; href: string; pid: string; when: string };

export default function PortfolioSummary() {
  const { state, setActiveProject } = useStore();
  const today = todayLocal();
  const data = useMemo(() => {
    const projects = state.projects;
    const active = projects.filter((p) => p.status === 'active');
    const completed = projects.filter((p) => p.status === 'completed');
    const actions: Action[] = [];
    const progress: number[] = [];
    let overdue = 0, upcoming = 0, stopped = 0, awaiting = 0;
    for (const p of projects) {
      const acts = state.activities.filter((a) => a.projectId === p.id);
      const reps = state.reports.filter((r) => r.projectId === p.id);
      const stops = (state.stops ?? []).filter((s) => s.projectId === p.id);
      const cal = calendarOf(state.calendars?.[p.id] ?? null);
      const code = p.code ?? p.id;
      if (p.status !== 'active') continue; // completed, on-hold and draft projects are not in the operational counts
      if (acts.length) progress.push(projectProgress(acts, reps, today, () => state.calendars?.[p.id] ?? null).actual);
      for (const a of acts) {
        const m = scopeMetrics(a, reps, today, cal, stops);
        if (m.status === 'Complete') continue;
        if (today > a.end) {
          overdue++;
          actions.push({ key: `od-${a.id}`, tone: 'bad', title: `${a.name} is overdue`, detail: `${code} · planned finish ${fmtDate(a.end)} · ${fmtPct(m.actualPct)} done`, href: '/project-management', pid: p.id, when: a.end });
        } else if (a.end <= addDays(today, 14)) {
          upcoming++;
          actions.push({ key: `up-${a.id}`, tone: 'info', title: `${a.name} due ${fmtDate(a.end)}`, detail: `${code} · ${fmtPct(m.actualPct)} done, ${fmtPct(m.plannedPct)} planned`, href: '/project-management', pid: p.id, when: a.end });
        }
        if (m.openStop) {
          stopped++;
          actions.push({ key: `st-${a.id}`, tone: 'warn', title: `Work stopped: ${a.name}`, detail: `${code} · since ${fmtDate(m.openStop.stoppedAt)} · restart from the Overview Gantt`, href: '/project-management', pid: p.id, when: m.openStop.stoppedAt.slice(0, 10) });
        }
        if (a.requiredPhotos) {
          const have = state.evidence.filter((e) => e.activityId === a.id).length;
          if (have < a.requiredPhotos) actions.push({ key: `ev-${a.id}`, tone: 'warn', title: `${a.requiredPhotos - have} required photo(s) missing`, detail: `${code} · ${a.name} (${have} of ${a.requiredPhotos})`, href: '/site-evidence', pid: p.id, when: a.end });
        }
      }
      const waiting = reps.filter((r) => r.status === 'submitted').length;
      if (waiting) {
        awaiting += waiting;
        actions.push({ key: `rv-${p.id}`, tone: 'warn', title: `${waiting} field report(s) awaiting review`, detail: `${code} · ${p.name}`, href: '/field-reports', pid: p.id, when: '' });
      }
    }
    const order = { bad: 0, warn: 1, info: 2 };
    actions.sort((a, b) => order[a.tone] - order[b.tone] || a.when.localeCompare(b.when));
    return {
      active: active.length, completed: completed.length, total: projects.length, overdue, upcoming, stopped, awaiting, actions,
      avg: progress.length ? progress.reduce((s, x) => s + x, 0) / progress.length : null, scheduled: progress.length,
    };
  }, [state, today]);

  const kpis: { label: string; value: string; sub: string; href: string }[] = [
    { label: 'Active projects', value: String(data.active), sub: `${data.completed} completed · ${data.total} in total`, href: '/projects' },
    { label: 'Average actual progress', value: data.avg == null ? '—' : fmtPct(data.avg), sub: data.scheduled ? `Across ${data.scheduled} active project(s) with a schedule` : 'No active project has a schedule yet', href: '/projects' },
    { label: 'Overdue activities', value: String(data.overdue), sub: 'Active projects · past planned finish', href: '/project-management' },
    { label: 'Reports awaiting review', value: String(data.awaiting), sub: 'Submitted field reports', href: '/field-reports' },
    { label: 'Work stoppages open', value: String(data.stopped), sub: 'Stopped and not yet restarted', href: '/project-management' },
    { label: 'Finishing in 14 days', value: String(data.upcoming), sub: 'Activities due soon', href: '/project-management' },
  ];

  return (
    <section className="portfolio" aria-label="Portfolio summary">
      <div className="grid kpis kpis-6">
        {kpis.map((k) => (
          <Link key={k.label} href={k.href} className="card kpi-link">
            <div className="kpi-label">{k.label}</div>
            <div className="kpi-val">{k.value}</div>
            <div className="kpi-sub">{k.sub}</div>
          </Link>
        ))}
      </div>
      <div className="card">
        <div className="card-head">
          <h2>Action center</h2>
          <span className="note">{data.actions.length ? `${data.actions.length} item(s) across your projects` : 'Nothing needs attention right now'}</span>
        </div>
        {data.actions.length === 0 ? (
          <div className="empty">No overdue activities, stoppages, missing evidence or reports waiting for review.</div>
        ) : (
          <ul className="action-list">
            {data.actions.slice(0, 12).map((a) => (
              <li key={a.key}>
                <Link href={a.href} onClick={() => setActiveProject(a.pid)}>
                  <span className={`pill ${a.tone === 'bad' ? 'pill-bad' : a.tone === 'warn' ? 'pill-warn' : ''}`}>{a.tone === 'bad' ? 'Overdue' : a.tone === 'warn' ? 'Attention' : 'Upcoming'}</span>
                  <span className="action-text"><b>{a.title}</b><small>{a.detail}</small></span>
                  <span aria-hidden="true">›</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {data.actions.length > 12 && <p className="note">Showing the 12 most urgent of {data.actions.length}.</p>}
      </div>
    </section>
  );
}
