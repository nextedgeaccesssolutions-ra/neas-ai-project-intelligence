'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import DataIO, { asPlan } from '@/components/DataIO';
import * as IO from '@/lib/moduleIO';
import ProjectBar, { Loading, NoProject } from '@/components/ProjectBar';
import { Gantt, SCurve } from '@/components/Charts';
import { useProjectData, useStore } from '@/lib/store';
import { actualPct, plannedPct, projectProgress, projectSpan, sCurve, todayLocal, totalWeight } from '@/lib/calc';
import { fmtDate, fmtPct, fmtPHP, fmtPP } from '@/lib/format';

const tone = (v: number) => (v >= 0 ? 'ok' : v > -10 ? 'warn' : 'bad');

export default function Overview() {
  const { ready, project, state } = useStore();
  const { activities, reports, evidence } = useProjectData();
  const [asOf, setAsOf] = useState<string>(() => todayLocal());

  const series = useMemo(() => sCurve(activities, reports), [activities, reports]);
  const span = projectSpan(activities);
  const status = useMemo(() => projectProgress(activities, reports, asOf), [activities, reports, asOf]);
  const variance = status.actual - status.planned;
  const weight = totalWeight(activities);

  if (!ready) return <Loading />;
  if (!project) return <NoProject />;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Operations</div>
          <h1>Project overview</h1>
          <p className="lead">Live project schedule, planned vs actual progress and field activity.</p>
        </div>
        <div className="form-actions" style={{ marginTop: 0 }}>
          <DataIO doc={() => IO.overviewDoc(state, asOf)} capture={() => document.querySelector('main.content')} label="items" />
          <Link className="btn btn-primary" href="/projects?new=1">+ New project</Link>
        </div>
      </div>

      <ProjectBar>
        <label className="field">
          Status as of
          <input className="input" type="date" value={asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} />
        </label>
        <div className="field">
          Schedule health
          <span className={`pill pill-${tone(variance)}`} style={{ minHeight: 42, justifyContent: 'center' }}>
            {variance >= 0 ? 'On or ahead of plan' : variance > -10 ? 'Slightly behind plan' : 'Behind plan'}
          </span>
        </div>
      </ProjectBar>

      {Math.abs(weight - 100) > 0.01 && activities.length > 0 && (
        <div className="banner">
          Activity weights add up to {weight}% instead of 100%. Progress is normalised, but{' '}
          <Link href="/project-management">fix the weights in Project management</Link>.
        </div>
      )}

      <section className="grid kpis">
        <div className="card">
          <div className="kpi-label">Contract value</div>
          <div className="kpi-val">{fmtPHP(project.contractValue)}</div>
          <div className="kpi-sub">{project.contractValue == null ? <Link href={`/projects?edit=${encodeURIComponent(project.id)}`}>Add in Project register</Link> : project.status}</div>
        </div>
        <div className="card">
          <div className="kpi-label">Planned progress</div>
          <div className="kpi-val">{fmtPct(status.planned)}</div>
          <div className="kpi-sub">Time-phased schedule · {fmtDate(asOf)}</div>
        </div>
        <div className="card">
          <div className="kpi-label">Actual progress</div>
          <div className="kpi-val">{fmtPct(status.actual)}</div>
          <div className={`kpi-sub ${tone(variance)}`}>{fmtPP(variance)} vs plan</div>
        </div>
        <div className="card">
          <div className="kpi-label">Activities / reports</div>
          <div className="kpi-val">{activities.length} / {reports.length}</div>
          <div className="kpi-sub">
            <Link href="/field-reports">Saved records</Link> · <Link href="/site-evidence">{evidence.length} photos</Link>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Project S-curve — planned vs actual</h2>
          <div className="legend">
            <span><i style={{ background: 'var(--planned)' }} />Planned</span>
            <span><i style={{ background: 'var(--gold)' }} />Actual</span>
          </div>
        </div>
        <SCurve series={series} asOf={asOf} />
        <p className="note">
          Planned progress spreads each activity evenly over its calendar days (start and finish inclusive), weighted by activity weight.
          Actual progress uses the latest saved field report per activity on or before each date.
        </p>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Project Gantt chart</h2>
          <span className="note">{span ? `${fmtDate(span.start)} — ${fmtDate(span.end)}` : ''}</span>
        </div>
        <Gantt rows={activities} asOf={asOf} actualOf={(id) => actualPct(id, reports, asOf)} />
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Activity progress</h2>
          <Link className="btn btn-sm" href="/project-management">Manage activities</Link>
        </div>
        {activities.length === 0 ? (
          <div className="empty">No activities. <Link href="/project-management">Add the first activity</Link>.</div>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Activity</th>
                  <th>Planned dates</th>
                  <th className="num">Weight</th>
                  <th className="num">Planned</th>
                  <th className="num">Latest actual</th>
                  <th>Progress</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {activities.map((a) => {
                  const p = plannedPct(a, asOf);
                  const act = actualPct(a.id, reports, asOf);
                  return (
                    <tr key={a.id}>
                      <td>{a.name}</td>
                      <td>{fmtDate(a.start)} – {fmtDate(a.end)}</td>
                      <td className="num">{a.weight}%</td>
                      <td className="num">{fmtPct(p)}</td>
                      <td className={`num ${tone(act - p)}`}>{fmtPct(act)}</td>
                      <td><div className="bar"><span style={{ width: `${act}%` }} /></div></td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <Link className="btn btn-sm" href={`/project-management?edit=${a.id}`}>Edit</Link>{' '}
                        <Link className="btn btn-sm" href={`/field-reports?activity=${a.id}`}>Report</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
