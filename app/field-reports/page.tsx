'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import DataIO, { asPlan } from '@/components/DataIO';
import * as IO from '@/lib/moduleIO';
import { useCanManage } from '@/components/RoleGate';
import { CLOUD } from '@/lib/cloud/env';
import { supabaseBrowser } from '@/lib/cloud/browser';
import { canManage, pullAll } from '@/lib/cloud/cloudSync';
import ProjectBar, { Loading, NoProject } from '@/components/ProjectBar';
import { useOrgList } from '@/components/OrgList';
import { useProjectData, useStore } from '@/lib/store';
import { useQueryParam } from '@/lib/useQuery';
import { actualPct, todayLocal } from '@/lib/calc';
import { fmtDate, fmtPct, uid } from '@/lib/format';
import { askConfirm, notify } from '@/components/Dialogs';
import { compressImage, putPhoto } from '@/lib/photos';
import { locatePhoto, photoRef, gpsSourceOf } from '@/lib/geo';
import type { Evidence } from '@/lib/types';
import WalkthroughReport from '@/components/WalkthroughReport';

export default function FieldReports() {
  const { ready, project, addReport, deleteReport, addEvidence, state, replaceAll } = useStore();
  const { pid, activities, reports, evidence } = useProjectData();
  const actParam = useQueryParam('activity');
  const reviewer = useCanManage();
  const review = async (id: string, patch: Record<string, unknown>, label: string) => {
    const sb = supabaseBrowser()!;
    const { error: err } = await sb.from('project_reports').update(patch).eq('id', id);
    if (err) return setError(`${label} failed: ${err.message}. Reviews need an internet connection.`);
    if ('client_visible' in patch) {
      await sb.from('report_attachments').update({ client_visible: patch.client_visible }).eq('report_id', id);
    }
    await pullAll().catch(() => undefined);
    setMsg(`${label}.`);
  };
  const [activityId, setActivityId] = useState('');
  const [date, setDate] = useState(() => todayLocal());
  const [pct, setPct] = useState('');
  const [qty, setQty] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [photoKind, setPhotoKind] = useState<Evidence['kind']>('Before');
  const fileRef = useRef<HTMLInputElement>(null);
  const [photoBusy, setPhotoBusy] = useState(false);

  useEffect(() => {
    if (!ready) return;
    if (actParam && activities.some((a) => a.id === actParam)) setActivityId(actParam);
    else if (!activities.some((a) => a.id === activityId)) setActivityId(activities[0]?.id ?? '');
  }, [ready, actParam, pid]); // eslint-disable-line react-hooks/exhaustive-deps

  const o = useOrgList({ list: 'field_reports', kind: 'field_report', items: filter ? reports.filter((r) => r.activityId === filter) : reports, id: (r) => r.id, project: (r) => r.projectId, noun: 'report' });

  const shareMany = async (share: boolean) => {
    const pool = reports.filter((r) => r.status === 'approved' && o.listed.some((x) => x.id === r.id));
    const chosen = pool.filter((r) => o.picked.has(r.id));
    const target = (chosen.length ? chosen : pool).filter((r) => !!r.clientVisible !== share);
    if (!target.length) return setMsg(share ? 'Those reports are already shared with the client.' : 'Those reports are already hidden from the client.');
    if (!(await askConfirm(`${share ? 'Share' : 'Hide'} ${target.length} approved report(s) ${share ? 'with' : 'from'} the client? Their photos follow.`, { danger: false }))) return;
    const sb = supabaseBrowser()!;
    let ok = 0, photoFail = 0;
    const failed: string[] = [];
    // one report at a time, only on projects this person manages, so every result is exact
    for (const r of target) {
      if (!canManage(r.projectId)) { failed.push('not a project you manage'); continue; }
      const { data, error: err } = await sb.from('project_reports').update({ client_visible: share }).eq('id', r.id).select('id');
      if (err || !data?.length) { failed.push(err?.message ?? 'not changed'); continue; }
      ok++;
      const { error: pe } = await sb.from('report_attachments').update({ client_visible: share }).eq('report_id', r.id);
      if (pe) photoFail++;
    }
    await pullAll().catch(() => undefined);
    setMsg(`${ok} report(s) ${share ? 'shared with' : 'hidden from'} the client.${failed.length ? ` ${failed.length} not changed (${[...new Set(failed)].join('; ')}).` : ''}${photoFail ? ` The photos of ${photoFail} report(s) did not follow; try again.` : ''}`);
  };
  const approveSelected = async () => {
    const ids = reports.filter((r) => o.picked.has(r.id) && r.status === 'submitted').map((r) => r.id);
    if (!ids.length) return setMsg('None of the selected reports is waiting for approval.');
    if (!(await askConfirm(`Approve ${ids.length} submitted report(s)?`, { danger: false }))) return;
    let ok = 0;
    const failed: string[] = [];
    for (const id of ids) {
      const { data, error: err } = await supabaseBrowser()!.from('project_reports').update({ status: 'approved' }).eq('id', id).eq('status', 'submitted').select('id');
      if (!err && data?.length) ok++;
      else failed.push(err?.message ?? 'already reviewed or not yours to approve');
    }
    await pullAll().catch(() => undefined);
    setMsg(`${ok} report(s) approved.${failed.length ? ` ${failed.length} not approved (${[...new Set(failed)].join('; ')}).` : ''}`);
  };

  if (!ready) return <Loading />;
  if (!project) return <NoProject />;

  const current = activities.find((a) => a.id === activityId);
  const measurable = !!current?.quantityTotal && current.quantityTotal > 0;
  const prev = activityId ? actualPct(activityId, reports, date, current) : 0;
  const name = (id: string) => activities.find((a) => a.id === id)?.name ?? '(deleted activity)';

  const save = async () => {
    const v = Number(pct);
    if (!activityId) return setError('Choose an activity. Add activities in Project management first.');
    if (!date) return setError('Report date is required.');
    if (pct.trim() === '' || !Number.isFinite(v) || v < 0 || v > 100) return setError('Actual completion must be a number from 0 to 100.');
    const q = measurable && qty.trim() !== '' ? Number(qty) : null;
    if (q != null && (!Number.isFinite(q) || q < 0)) return setError('Completed quantity must be 0 or more.');
    if (q != null && q > current!.quantityTotal! && !(await askConfirm(`Completed quantity is more than the approved ${current!.quantityTotal} ${current!.quantityUnit ?? ''}. Save anyway?`, { danger: false }))) return;
    if (v < prev && !(await askConfirm(`This is lower than the previous report (${fmtPct(prev)}). Save anyway?`, { danger: false }))) return;
    addReport({ id: uid('rep'), projectId: pid, activityId, date, actualPct: v, completedQty: q, notes: notes.trim(), createdAt: new Date().toISOString() });
    setMsg(`Saved: ${name(activityId)} at ${fmtPct(v)} on ${fmtDate(date)}.`);
    setError(null);
    setPct('');
    setQty('');
    setNotes('');
  };

  const attachPhoto = async () => {
    const files = Array.from(fileRef.current?.files ?? []);
    if (!activityId) return setError('Choose an activity first.');
    if (!files.length) return setError('Choose or capture a photo.');
    setPhotoBusy(true);
    let ok = 0;
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      try {
        const gps = await locatePhoto(file, { enabled: true });
        const blob = await compressImage(file);
        const id = uid('ev');
        const takenAt = new Date(file.lastModified || Date.now()).toISOString();
        await putPhoto(id, blob);
        addEvidence({ id, projectId: pid, activityId, kind: photoKind, caption: file.name.replace(/\.[^.]+$/, ''), takenAt, bytes: blob.size, gps: gps.fix, gpsStatus: gps.status, gpsSource: gpsSourceOf(gps), pairId: null, ref: photoRef(photoKind, takenAt, id) });
        ok++;
      } catch { /* skip */ }
    }
    setPhotoBusy(false);
    if (fileRef.current) fileRef.current.value = '';
    if (ok) notify(`${ok} photo(s) added to ${name(activityId)}.`);
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
          <Link className="btn btn-sm btn-primary" href="/reports">Preview reports</Link>
        </div>
      </div>
      <ProjectBar />

      <WalkthroughReport
        pid={pid}
        projectName={project.name}
        activities={activities}
        reports={reports}
        evidence={evidence}
        addEvidence={addEvidence}
        onPick={(id) => {
          setActivityId(id);
          setFilter(id);
          document.getElementById('new-report')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }}
      />

      <section className="card" id="new-report">
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
                {measurable && (
                  <label className="field">
                    Completed quantity ({current!.quantityUnit || 'units'}) <span className="note">of {current!.quantityTotal}</span>
                    <input className="input" type="number" inputMode="decimal" min="0" step="any" value={qty} onChange={(e) => {
                      setQty(e.target.value);
                      const n = Number(e.target.value);
                      if (e.target.value.trim() !== '' && Number.isFinite(n)) setPct(String(Math.min(100, Math.round((n / current!.quantityTotal!) * 1000) / 10)));
                    }} />
                  </label>
                )}
                <label className="field">
                  Report notes
                  <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Site work completed / issues" />
                </label>
              </div>
              {error && <p className="bad" role="alert">{error}</p>}
              {msg && !error && <p className="ok" role="status">{msg} <Link href="/">See it on the Overview</Link></p>}
              <div className="form-actions">
                <button className="btn btn-primary" onClick={save}>Save field report</button>
                {activityId && (
                  <>
                    <select className="input" style={{ width: 'auto' }} value={photoKind} onChange={(e) => setPhotoKind(e.target.value as Evidence['kind'])}>
                      <option>Before</option><option>During</option><option>After</option>
                    </select>
                    <input ref={fileRef} type="file" accept="image/*" multiple className="input" style={{ width: 'auto' }} />
                    <button className="btn" onClick={attachPhoto} disabled={photoBusy}>{photoBusy ? 'Saving…' : 'Add photo'}</button>
                  </>
                )}
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
        {o.toolbar}
        {CLOUD && reviewer && !o.showHidden && (
          <div className="form-actions" style={{ marginTop: 0 }}>
            {reports.some((r) => o.picked.has(r.id) && r.status === 'submitted') && <button className="btn btn-sm btn-primary" onClick={approveSelected}>Approve selected ({reports.filter((r) => o.picked.has(r.id) && r.status === 'submitted').length} waiting)</button>}
            {reports.some((r) => r.status === 'approved') && <>
              <button className="btn btn-sm" onClick={() => shareMany(true)}>Share {reports.some((r) => o.picked.has(r.id) && r.status === 'approved') ? 'selected' : 'all approved'} with client</button>
              <button className="btn btn-sm" onClick={() => shareMany(false)}>Hide {reports.some((r) => o.picked.has(r.id) && r.status === 'approved') ? 'selected' : 'all'} from client</button>
            </>}
          </div>
        )}
        {o.listed.length === 0 ? (
          <div className="empty">{o.showHidden ? 'You have not hidden any field reports.' : 'No field reports yet.'}</div>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th className="pick-col">{o.headerCheckbox}</th><th>Date</th><th>Activity</th><th className="num">Actual</th><th>Notes</th><th>Saved</th>{CLOUD && <th>Review</th>}<th /></tr></thead>
              {o.tbodies((r) => (
                  <tr>
                    <td className="pick-col">{o.checkbox(r)}</td>
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
                ), CLOUD ? 8 : 7)}
            </table>
          </div>
        )}
      </section>
    </>
  );
}
