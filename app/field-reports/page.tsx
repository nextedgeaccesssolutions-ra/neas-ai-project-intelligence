'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import DataIO, { asPlan } from '@/components/DataIO';
import * as IO from '@/lib/moduleIO';
import { useCanManage } from '@/components/RoleGate';
import { CLOUD } from '@/lib/cloud/env';
import { supabaseBrowser } from '@/lib/cloud/browser';
import { pullAll } from '@/lib/cloud/cloudSync';
import ProjectBar, { Loading, NoProject } from '@/components/ProjectBar';
import { useProjectData, useStore } from '@/lib/store';
import { useQueryParam } from '@/lib/useQuery';
import { actualPct, todayLocal } from '@/lib/calc';
import { fmtDate, fmtPct, uid } from '@/lib/format';
import { askConfirm } from '@/components/Dialogs';

export default function FieldReports() {
  const { ready, project, addReport, deleteReport, state, replaceAll } = useStore();
  const { pid, activities, reports } = useProjectData();
  const actParam = useQueryParam('activity');
  const reviewer = useCanManage();
  const review = async (id: string, patch: Record<string, unknown>, label: string) => {
    const { error: err } = await supabaseBrowser()!.from('project_reports').update(patch).eq('id', id);
    if (err) return setError(`${label} failed: ${err.message}. Reviews need an internet connection.`);
    await pullAll().catch(() => undefined);
    setMsg(`${label}.`);
  };
  const [activityId, setActivityId] = useState('');
  const [date, setDate] = useState(() => todayLocal());
  const [pct, setPct] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (!ready) return;
    if (actParam && activities.some((a) => a.id === actParam)) setActivityId(actParam);
    else if (!activities.some((a) => a.id === activityId)) setActivityId(activities[0]?.id ?? '');
  }, [ready, actParam, pid]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready) return <Loading />;
  if (!project) return <NoProject />;

  const prev = activityId ? actualPct(activityId, reports, date) : 0;
  const name = (id: string) => activities.find((a) => a.id === id)?.name ?? '(deleted activity)';

  const save = async () => {
    const v = Number(pct);
    if (!activityId) return setError('Choose an activity. Add activities in Project management first.');
    if (!date) return setError('Report date is required.');
    if (pct.trim() === '' || !Number.isFinite(v) || v < 0 || v > 100) return setError('Actual completion must be a number from 0 to 100.');
    if (v < prev && !(await askConfirm(`This is lower than the previous report (${fmtPct(prev)}). Save anyway?`, { danger: false }))) return;
    addReport({ id: uid('rep'), projectId: pid, activityId, date, actualPct: v, notes: notes.trim(), createdAt: new Date().toISOString() });
    setMsg(`Saved: ${name(activityId)} at ${fmtPct(v)} on ${fmtDate(date)}.`);
    setError(null);
    setPct('');
    setNotes('');
  };

  const shown = filter ? reports.filter((r) => r.activityId === filter) : reports;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Field operations</div>
          <h1>Field reports</h1>
          <p className="lead">Record cumulative % complete per activity. Each saved report updates the Overview straight away.</p>
        </div>
        <div className="form-actions" style={{ marginTop: 0 }}>
          <DataIO doc={() => IO.reportsDoc(state, filter)} capture={() => document.getElementById('reports-card')} importColumns={IO.COLS.reports} importSheet="Field_Reports" onImport={(rows) => asPlan(IO.planReports(state, rows), replaceAll)} label="field reports" />
          <Link className="btn btn-sm" href="/site-evidence">Attach site photos</Link>
        </div>
      </div>
      <ProjectBar />

      <section className="card">
        <div className="card-head"><h2>New field report</h2><span className="note">Saved on this device; works offline.</span></div>
        {activities.length === 0 ? (
          <div className="empty">This project has no activities. <Link href="/project-management">Add activities first</Link>.</div>
        ) : (
          <>
            <div className="form-grid">
              <label className="field">
                Activity
                <select className="input" value={activityId} onChange={(e) => setActivityId(e.target.value)}>
                  {activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
              <label className="field">
                Report date
                <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
              <label className="field">
                Actual completion (%) <span className="note">Previous: {fmtPct(prev)}</span>
                <input className="input" type="number" inputMode="decimal" min="0" max="100" step="0.1" value={pct} onChange={(e) => setPct(e.target.value)} />
              </label>
              <label className="field">
                Report notes
                <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Site work completed / issues" />
              </label>
            </div>
            {error && <p className="bad" role="alert">{error}</p>}
            {msg && !error && <p className="ok" role="status">{msg} <Link href="/">See it on the Overview</Link></p>}
            <div className="form-actions">
              <button className="btn btn-primary" onClick={save}>Save field report</button>
              {activityId && <Link className="btn" href={`/site-evidence?activity=${activityId}`}>Add photo for this activity</Link>}
            </div>
          </>
        )}
      </section>

      <section className="card" id="reports-card">
        <div className="card-head">
          <h2>Saved reports ({shown.length})</h2>
          <select className="input" style={{ maxWidth: 280 }} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter by activity">
            <option value="">All activities</option>
            {activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        {shown.length === 0 ? (
          <div className="empty">No field reports yet.</div>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Date</th><th>Activity</th><th className="num">Actual</th><th>Notes</th><th>Saved</th>{CLOUD && <th>Review</th>}<th /></tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id}>
                    <td>{fmtDate(r.date)}</td>
                    <td>{name(r.activityId)}</td>
                    <td className="num">{fmtPct(r.actualPct)}</td>
                    <td>{r.notes || <span className="note">—</span>}</td>
                    <td className="note">{new Date(r.createdAt).toLocaleString()}</td>
                    {CLOUD && (
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <span className={`pill ${r.status === 'approved' ? 'pill-ok' : r.status === 'rejected' ? 'pill-bad' : 'pill-warn'}`}>{r.status ?? 'pending sync'}</span>
                        {reviewer && r.status === 'submitted' && (
                          <>{' '}<button className="btn btn-sm btn-primary" onClick={() => review(r.id, { status: 'approved' }, 'Report approved')}>Approve</button>{' '}
                          <button className="btn btn-sm" onClick={() => review(r.id, { status: 'rejected' }, 'Report rejected')}>Reject</button></>
                        )}
                        {reviewer && r.status === 'approved' && (
                          <label className="note" style={{ display: 'inline-flex', gap: 4, marginLeft: 6 }}>
                            <input type="checkbox" checked={!!r.clientVisible} onChange={(e) => review(r.id, { client_visible: e.target.checked }, e.target.checked ? 'Shared with client' : 'Hidden from client')} /> client
                          </label>
                        )}
                      </td>
                    )}
                    <td>{(!CLOUD || r.status !== 'approved') && <button className="btn btn-sm btn-danger" onClick={() => askConfirm('Delete this field report?').then((ok) => ok && deleteReport(r.id))}>Delete</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
