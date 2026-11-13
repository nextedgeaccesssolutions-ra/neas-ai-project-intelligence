'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import DataIO, { asPlan } from '@/components/DataIO';
import * as IO from '@/lib/moduleIO';
import { useCanManage } from '@/components/RoleGate';
import ProjectBar, { Loading, NoProject } from '@/components/ProjectBar';
import { useProjectData, useStore } from '@/lib/store';
import { useQueryParam } from '@/lib/useQuery';
import { durationDays, latestReport, plannedPct, todayLocal, totalWeight } from '@/lib/calc';
import { fmtDate, fmtPct, fmtPP, uid } from '@/lib/format';
import { askConfirm } from '@/components/Dialogs';
import type { Activity, FieldReport } from '@/lib/types';

type Draft = {
  id: string | null;
  name: string;
  start: string;
  end: string;
  weight: string;
  actual: string; // latest actual progress (%)
  actualDate: string; // date the progress applies to
  note: string;
};

const blank = (): Draft => ({ id: null, name: '', start: todayLocal(), end: todayLocal(), weight: '', actual: '0', actualDate: todayLocal(), note: '' });

const fromActivity = (a: Activity, reports: FieldReport[]): Draft => {
  const last = latestReport(a.id, reports);
  return {
    id: a.id,
    name: a.name,
    start: a.start,
    end: a.end,
    weight: String(a.weight),
    actual: String(last?.actualPct ?? 0),
    actualDate: todayLocal(),
    note: '',
  };
};

const tone = (v: number) => (v >= 0 ? 'ok' : v > -10 ? 'warn' : 'bad');

export default function ProjectManagement() {
  const { ready, project, upsertActivity, deleteActivity, addReport, state, replaceAll } = useStore();
  const { pid, activities, reports } = useProjectData();
  const editParam = useQueryParam('edit');
  const canEdit = useCanManage();
  const [draft, setDraft] = useState<Draft>(blank);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!editParam || !ready) return;
    const a = activities.find((x) => x.id === editParam);
    if (a) setDraft(fromActivity(a, reports));
  }, [editParam, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready) return <Loading />;
  if (!project) return <NoProject />;

  const weight = totalWeight(activities);
  const weightOk = Math.abs(weight - 100) < 0.01;
  const editing = draft.id ? activities.find((a) => a.id === draft.id) : undefined;
  const last = draft.id ? latestReport(draft.id, reports) : null;
  const lastPct = last?.actualPct ?? 0;
  const actualNum = Number(draft.actual);
  const progressChanged = draft.actual.trim() !== '' && Number.isFinite(actualNum) && Math.abs(actualNum - lastPct) > 1e-9;
  const plannedAtDate = draft.start && draft.end && draft.end >= draft.start ? plannedPct({ start: draft.start, end: draft.end }, draft.actualDate || todayLocal()) : 0;

  const startEdit = (a: Activity) => {
    setDraft(fromActivity(a, reports));
    setMsg(null);
    setError(null);
    document.getElementById('activity-form')?.scrollIntoView({ behavior: 'smooth' });
  };

  const save = async () => {
    const w = Number(draft.weight);
    if (!draft.name.trim()) return setError('Activity name is required.');
    if (!draft.start || !draft.end) return setError('Start and finish dates are required.');
    if (draft.end < draft.start) return setError('Finish date cannot be before the start date.');
    if (!Number.isFinite(w) || w <= 0 || w > 100) return setError('Weight must be more than 0 and at most 100.');
    if (draft.actual.trim() === '' || !Number.isFinite(actualNum) || actualNum < 0 || actualNum > 100)
      return setError('Latest actual progress must be a number from 0 to 100.');
    if (progressChanged && !draft.actualDate) return setError('Choose the date this progress applies to.');
    if (progressChanged && actualNum < lastPct) {
      const ok = await askConfirm(`Actual progress goes down from ${fmtPct(lastPct)} to ${fmtPct(actualNum)}. Record it anyway?`, { danger: false });
      if (!ok) return;
    }

    const a: Activity = { id: draft.id ?? uid('act'), projectId: pid, name: draft.name.trim(), start: draft.start, end: draft.end, weight: w };
    upsertActivity(a);
    // Progress is stored as a field report, the single source for actual % everywhere
    // (Overview KPIs, S-curve, Gantt, Field reports, Project register).
    const recordProgress = progressChanged || (!draft.id && actualNum > 0);
    if (recordProgress) {
      addReport({
        id: uid('rep'),
        projectId: pid,
        activityId: a.id,
        date: draft.actualDate,
        actualPct: actualNum,
        notes: draft.note.trim() || 'Progress updated in Project management',
        createdAt: new Date().toISOString(),
      });
    }
    setMsg(
      `${draft.id ? 'Updated' : 'Added'} “${a.name}”` +
        (recordProgress ? `, actual ${fmtPct(actualNum)} as of ${fmtDate(draft.actualDate)}. Overview, Gantt, S-curve and Field reports are updated.` : '.'),
    );
    setError(null);
    setDraft(blank());
  };

  const remove = async (a: Activity) => {
    const n = reports.filter((r) => r.activityId === a.id).length;
    if (!(await askConfirm(`Delete “${a.name}”${n ? ` and its ${n} field report(s)` : ''}? This cannot be undone.`))) return;
    deleteActivity(a.id);
    if (draft.id === a.id) setDraft(blank());
    setMsg(`Deleted “${a.name}”.`);
  };

  const today = todayLocal();

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Planning</div>
          <h1>Project management</h1>
          <p className="lead">Work breakdown, planned dates, weights and actual progress. Changes here update every module straight away.</p>
        </div>
        <div className="form-actions" style={{ marginTop: 0 }}>
          <DataIO doc={() => IO.activitiesDoc(state)} capture={() => document.getElementById('activities-card')} importColumns={canEdit ? IO.COLS.activities : undefined} importSheet="Activities" onImport={(rows) => asPlan(IO.planActivities(state, rows), replaceAll)} label="activities" />
          <Link className="btn btn-sm" href="/">View S-curve and Gantt</Link>
        </div>
      </div>
      <ProjectBar />

      {!canEdit && <div className="banner">View only: the schedule is maintained by the project manager. Record your progress in Field reports.</div>}
      {canEdit && <section className="card" id="activity-form">
        <div className="card-head">
          <h2>{draft.id ? 'Edit activity' : 'Add activity'}</h2>
          <span className={`pill ${weightOk ? 'pill-ok' : 'pill-warn'}`}>Total weight {weight}%{weightOk ? '' : ' — should be 100%'}</span>
        </div>

        <div className="form-grid">
          <label className="field" style={{ gridColumn: 'span 2' }}>
            Activity name
            <input id="act-name" className="input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Rope access facade cleaning" />
          </label>
          <label className="field">
            Start
            <input id="act-start" className="input" type="date" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} />
          </label>
          <label className="field">
            Finish
            <input id="act-end" className="input" type="date" value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} />
          </label>
          <label className="field">
            Weight (%)
            <input id="act-weight" className="input" type="number" min="0" max="100" step="0.1" value={draft.weight} onChange={(e) => setDraft({ ...draft, weight: e.target.value })} />
          </label>
        </div>

        <fieldset className="progress-box">
          <legend>Actual progress</legend>
          <div className="form-grid">
            <label className="field">
              Latest actual progress (%)
              <div className="pct-row">
                <input
                  id="act-actual"
                  className="input"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max="100"
                  step="0.1"
                  value={draft.actual}
                  onChange={(e) => setDraft({ ...draft, actual: e.target.value })}
                />
                <input
                  aria-label="Latest actual progress slider"
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={Number.isFinite(actualNum) ? actualNum : 0}
                  onChange={(e) => setDraft({ ...draft, actual: e.target.value })}
                />
              </div>
            </label>
            <label className="field">
              Progress as of
              <input id="act-actual-date" className="input" type="date" max={today} value={draft.actualDate} onChange={(e) => setDraft({ ...draft, actualDate: e.target.value })} />
            </label>
            <label className="field" style={{ gridColumn: 'span 2' }}>
              Progress note (optional)
              <input id="act-note" className="input" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="e.g. North elevation done to level 8" />
            </label>
          </div>
          <div className="progress-meta">
            <span>
              Last report: {last ? <b>{fmtPct(last.actualPct)}</b> : <b>none</b>}
              {last ? ` on ${fmtDate(last.date)}` : ''}
            </span>
            <span>
              Planned on {fmtDate(draft.actualDate || today)}: <b>{fmtPct(plannedAtDate)}</b>
            </span>
            {Number.isFinite(actualNum) && draft.actual.trim() !== '' && (
              <span className={tone(actualNum - plannedAtDate)}>Variance {fmtPP(actualNum - plannedAtDate)}</span>
            )}
            {progressChanged ? (
              <span className="pill pill-warn">Will record a field report on save</span>
            ) : (
              draft.id && <span className="pill">No progress change</span>
            )}
          </div>
          {editing && (
            <p className="note" style={{ margin: '8px 0 0' }}>
              Actual progress is saved as a field report, so its history stays in <Link href={`/field-reports?activity=${editing.id}`}>Field reports</Link>.
            </p>
          )}
        </fieldset>

        {error && <p className="bad" role="alert">{error}</p>}
        {msg && !error && (
          <p className="ok" role="status">
            {msg} <Link href="/">Open Overview</Link>
          </p>
        )}
        <div className="form-actions">
          <button className="btn btn-primary" onClick={save}>{draft.id ? 'Save changes' : 'Add activity'}</button>
          {draft.id && (
            <button className="btn" onClick={() => { setDraft(blank()); setError(null); }}>
              Cancel edit
            </button>
          )}
        </div>
      </section>}

      <section className="card" id="activities-card">
        <div className="card-head">
          <h2>Activities ({activities.length})</h2>
          <span className="note">Planned and variance as of today, {fmtDate(today)}</span>
        </div>
        {activities.length === 0 ? (
          <div className="empty">No activities yet. Add one above.</div>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Activity</th>
                  <th>Start</th>
                  <th>Finish</th>
                  <th className="num">Days</th>
                  <th className="num">Weight</th>
                  <th className="num">Planned</th>
                  <th className="num">Latest actual</th>
                  <th>Progress</th>
                  <th>Last report</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {activities.map((a) => {
                  const lr = latestReport(a.id, reports);
                  const act = lr?.actualPct ?? 0;
                  const plan = plannedPct(a, today);
                  return (
                    <tr key={a.id} style={draft.id === a.id ? { background: '#fff8ea' } : undefined}>
                      <td>{a.name}</td>
                      <td>{fmtDate(a.start)}</td>
                      <td>{fmtDate(a.end)}</td>
                      <td className="num">{durationDays(a)}</td>
                      <td className="num">{a.weight}%</td>
                      <td className="num">{fmtPct(plan)}</td>
                      <td className={`num ${tone(act - plan)}`}>{fmtPct(act)}</td>
                      <td><div className="bar" title={`${fmtPct(act)} complete`}><span style={{ width: `${act}%` }} /></div></td>
                      <td className="note">{lr ? fmtDate(lr.date) : 'None'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {canEdit && <><button className="btn btn-sm" onClick={() => startEdit(a)}>Edit</button>{' '}</>}
                        <Link className="btn btn-sm" href={`/field-reports?activity=${a.id}`}>Report</Link>{' '}
                        {canEdit && <button className="btn btn-sm btn-danger" onClick={() => remove(a)}>Delete</button>}
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
