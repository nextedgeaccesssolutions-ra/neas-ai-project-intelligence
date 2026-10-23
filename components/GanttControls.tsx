'use client';
// Interactive Gantt: select a scope to see its details, drag to propose schedule or progress
// changes, record STOP WORK / RESTART WORK and actual progress. Nothing is saved without a form.
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Gantt, type GanttProposal } from '@/components/Charts';
import { useStore } from '@/lib/store';
import { actualPct, todayLocal } from '@/lib/calc';
import { calendarOf, scopeMetrics } from '@/lib/schedule';
import { fmtDate, fmtPct, fmtPP, uid } from '@/lib/format';
import { STOP_REASONS, type Activity, type ActivityStop, type FieldReport, type StopReason } from '@/lib/types';

type Mode = null | 'stop' | 'restart' | 'progress';
const nowLocal = () => { const d = new Date(); d.setSeconds(0, 0); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const toIso = (local: string) => new Date(local).toISOString();
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' });
const num = (v: string) => (v.trim() === '' ? null : Number(v));

export default function GanttControls({ pid, activities, reports, stops, asOf, canManage }: {
  pid: string; activities: Activity[]; reports: FieldReport[]; stops: ActivityStop[]; asOf: string; canManage: boolean;
}) {
  const { upsertActivity, addReport, stopWork, restartWork, calendarFor, state } = useStore();
  const cal = calendarOf(calendarFor(pid));
  const [sel, setSel] = useState<string | null>(null);
  const [proposal, setProposal] = useState<GanttProposal | null>(null);
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState<Mode>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const a = activities.find((x) => x.id === sel) ?? null;
  const m = useMemo(() => (a ? scopeMetrics(a, reports, asOf, cal, stops) : null), [a, reports, asOf, cal, stops]);
  const history = stops.filter((s) => s.activityId === sel).slice().reverse();
  const open = history.find((s) => !s.restartedAt) ?? null;

  const pick = (id: string) => { if (id !== sel) { setSel(id); setMode(null); setMsg(null); } };
  const propose = (p: GanttProposal) => {
    setSel(p.id);
    setMsg(null);
    if (p.pct != null && p.start == null && p.end == null) { setProposal(null); setMode('progress'); setDraftPct(String(p.pct)); return; }
    setProposal(p);
    setMode(null);
  };
  const cancel = () => { setProposal(null); setReason(''); };
  const proposed = proposal && activities.find((x) => x.id === proposal.id);
  const saveSchedule = () => {
    if (!proposed || !proposal) return;
    if (!reason.trim()) return setMsg({ ok: false, text: 'Give a reason for the schedule change.' });
    upsertActivity({ ...proposed, start: proposal.start ?? proposed.start, end: proposal.end ?? proposed.end, delayReason: reason.trim() });
    setMsg({ ok: true, text: `Rescheduled “${proposed.name}”. Actual progress is unchanged; the original baseline is kept.` });
    cancel();
  };

  // ---- update actual progress ----
  const [date, setDate] = useState(todayLocal());
  const [qty, setQty] = useState('');
  const [draftPct, setDraftPct] = useState('');
  const [why, setWhy] = useState('');
  const [remaining, setRemaining] = useState('');
  const [started, setStarted] = useState('');
  const [remarks, setRemarks] = useState('');
  const measurable = !!a?.quantityTotal && a.quantityTotal > 0;
  const prevPct = a ? actualPct(a.id, reports, date, a) : 0;
  const saveProgress = () => {
    if (!a) return;
    const q = num(qty), p = num(draftPct), rem = num(remaining);
    if (!date) return setMsg({ ok: false, text: 'Choose the reporting date.' });
    if (date > todayLocal()) return setMsg({ ok: false, text: 'The reporting date cannot be in the future.' });
    if (q != null && (!Number.isFinite(q) || q < 0)) return setMsg({ ok: false, text: 'Completed quantity must be 0 or more.' });
    if (measurable && q != null && q > a.quantityTotal!) return setMsg({ ok: false, text: `Completed quantity is more than the approved ${a.quantityTotal} ${a.quantityUnit}. Record an approved scope variation first.` });
    const pct = measurable && q != null ? Math.round((q / a.quantityTotal!) * 1000) / 10 : p;
    if (pct == null || !Number.isFinite(pct) || pct < 0 || pct > 100) return setMsg({ ok: false, text: measurable ? 'Enter the verified completed quantity (or a % with an explanation).' : 'Actual progress must be 0–100%.' });
    if (measurable && q == null && !why.trim()) return setMsg({ ok: false, text: 'Explain why a percentage is used instead of the measured quantity.' });
    if (rem != null && (!Number.isFinite(rem) || rem < 0)) return setMsg({ ok: false, text: 'Remaining working days must be 0 or more.' });
    const dup = reports.some((r) => r.activityId === a.id && r.date === date && r.actualPct === pct && (r.completedQty ?? null) === (q ?? null) && r.status !== 'rejected');
    if (dup) return setMsg({ ok: false, text: 'The same accomplishment is already recorded for this date.' });
    const note = [remarks.trim(), q == null && why.trim() ? `Manual %: ${why.trim()}` : '', `Recorded by ${state.userName || 'field staff'}`].filter(Boolean).join(' · ');
    addReport({ id: uid('rep'), projectId: pid, activityId: a.id, date, actualPct: pct, completedQty: q, notes: note, createdAt: new Date().toISOString() });
    const actualStart = a.actualStart ?? (started || date);
    upsertActivity({ ...a, actualStart, remainingDays: rem ?? a.remainingDays ?? null, actualFinish: pct >= 100 ? a.actualFinish ?? date : a.actualFinish ?? null });
    setMsg({ ok: true, text: `Recorded ${fmtPct(pct)} for “${a.name}” on ${fmtDate(date)}${q != null ? ` (${q} ${a.quantityUnit})` : ''}. It is verified through Field reports approval.` });
    setMode(null); setQty(''); setDraftPct(''); setWhy(''); setRemaining(''); setRemarks('');
  };

  // ---- stop / restart ----
  const [at, setAt] = useState(nowLocal());
  const [stopReason, setStopReason] = useState<StopReason>('weather');
  const [supervisor, setSupervisor] = useState('');
  const [affects, setAffects] = useState(true);
  const [safety, setSafety] = useState(false);
  const saveStop = () => {
    if (!a) return;
    if (!at) return setMsg({ ok: false, text: 'Enter the actual stop date and time.' });
    if (!supervisor.trim()) return setMsg({ ok: false, text: 'Name the responsible supervisor.' });
    const lastBack = history.map((s) => s.restartedAt).filter(Boolean).sort().pop();
    if (lastBack && toIso(at) < lastBack) return setMsg({ ok: false, text: `The stop must be after the last restart (${when(lastBack)}).` });
    if (stopReason === 'other' && !remarks.trim()) return setMsg({ ok: false, text: 'Explain the reason in the remarks.' });
    stopWork({ id: uid('stop'), projectId: pid, activityId: a.id, stoppedAt: toIso(at), reason: stopReason, remarks: remarks.trim(), supervisor: supervisor.trim(), affectsSchedule: affects, restartedAt: null, restartSupervisor: '', restartRemarks: '', safetyCleared: false, remainingDays: null });
    setMsg({ ok: true, text: `“${a.name}” is STOPPED from ${when(toIso(at))}. Progress is held until new verified work is reported.` });
    setMode(null); setRemarks('');
  };
  const saveRestart = () => {
    if (!a || !open) return;
    const rem = num(remaining);
    if (!at || toIso(at) < open.stoppedAt) return setMsg({ ok: false, text: 'The restart must be after the stop.' });
    if (!supervisor.trim()) return setMsg({ ok: false, text: 'Name the supervisor confirming the restart.' });
    if (!safety) return setMsg({ ok: false, text: 'Confirm that the required safety checks, permits and clearances are complete.' });
    if (rem == null || !Number.isFinite(rem) || rem < 0) return setMsg({ ok: false, text: 'Estimate the remaining working days.' });
    restartWork(open.id, { restartedAt: toIso(at), restartSupervisor: supervisor.trim(), restartRemarks: remarks.trim(), safetyCleared: true, remainingDays: rem });
    upsertActivity({ ...a, remainingDays: rem });
    const f = cal.nthWorkingDay(at.slice(0, 10), rem);
    setMsg({ ok: true, text: `“${a.name}” restarted ${when(toIso(at))}. Forecast finish ${fmtDate(f)}.` });
    setMode(null); setRemarks(''); setRemaining(''); setSafety(false);
  };
  const openForm = (next: Mode) => { setMode(next); setMsg(null); setAt(nowLocal()); setSupervisor(state.userName || ''); setSafety(false); setRemarks(''); if (next === 'progress') setDate(todayLocal()); };

  return (
    <>
      <Gantt rows={activities} asOf={asOf} actualOf={(id) => actualPct(id, reports, asOf, activities.find((x) => x.id === id))}
        stops={stops} selected={sel} onSelect={pick} editable={canManage} proposal={proposal} onPropose={propose} />
      <p className="note">
        {canManage ? 'Drag a bar to move it, its ends to change start or finish, or the round marker to propose progress. ' : ''}
        Select a scope for its details, stop/restart history and actions. Hatched red = work stopped; ▼ green = restart.
      </p>

      {proposed && proposal && (
        <div className="banner" role="region" aria-label="Proposed schedule change">
          <b>Proposed:</b> “{proposed.name}” {fmtDate(proposed.start)} – {fmtDate(proposed.end)} → <b>{fmtDate(proposal.start ?? proposed.start)} – {fmtDate(proposal.end ?? proposed.end)}</b>
          {' '}({cal.workingDays(proposal.start ?? proposed.start, proposal.end ?? proposed.end)} working days, was {cal.workingDays(proposed.start, proposed.end)}). Actual progress is not changed.
          <div className="form-actions" style={{ marginTop: 8 }}>
            <input className="input" style={{ maxWidth: 360 }} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required), e.g. client instruction" aria-label="Reason for schedule change" />
            <button className="btn btn-primary" onClick={saveSchedule}>Save schedule change</button>
            <button className="btn" onClick={cancel}>Cancel</button>
          </div>
        </div>
      )}
      {msg && <p className={msg.ok ? 'ok' : 'bad'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>}

      {a && m && (
        <div className="card" style={{ marginTop: 12, boxShadow: 'none' }} id="scope-detail">
          <div className="card-head">
            <h2>{a.name} <span className={`pill ${m.status === 'Complete' ? 'pill-ok' : m.status === 'Stopped' || m.status === 'Delayed' ? 'pill-warn' : ''}`}>{m.status.toUpperCase()}</span></h2>
            <div className="form-actions" style={{ marginTop: 0 }}>
              <button className="btn btn-sm" onClick={() => openForm('progress')}>Update actual progress</button>
              {!open && m.status !== 'Complete' && <button className="btn btn-sm btn-danger" onClick={() => openForm('stop')}>STOP WORK</button>}
              {open && canManage && <button className="btn btn-sm btn-primary" onClick={() => openForm('restart')}>RESTART WORK</button>}
              <button className="btn btn-sm" onClick={() => setSel(null)} aria-label="Close details">✕</button>
            </div>
          </div>
          <div className="kv-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '6px 16px' }}>
            <div><span className="note">Baseline</span><div>{a.baselineStart ? `${fmtDate(a.baselineStart)} – ${fmtDate(a.baselineEnd ?? a.end)}` : '—'}</div></div>
            <div><span className="note">Current plan</span><div>{fmtDate(a.start)} – {fmtDate(a.end)}</div></div>
            <div><span className="note">Actual</span><div>{a.actualStart ? `${fmtDate(a.actualStart)} – ${a.actualFinish ? fmtDate(a.actualFinish) : '…'}` : 'Not started'}</div></div>
            <div><span className="note">Planned / actual</span><div>{fmtPct(m.plannedPct)} / <b>{fmtPct(m.actualPct)}</b> ({fmtPP(m.variancePts)})</div></div>
            <div><span className="note">Worked / elapsed / stopped days</span><div>{m.actualDays ?? 'N/A'} / {m.grossDays ?? 'N/A'} / {m.stoppedDays}</div></div>
            <div><span className="note">Time used</span><div>{m.timeConsumptionPct == null ? 'N/A' : fmtPct(m.timeConsumptionPct)}</div></div>
            <div><span className="note">Remaining</span><div>{m.remainingDays ?? 'N/A'} working days{measurable ? ` · ${Math.max(0, a.quantityTotal! - (latestQty(a.id, reports, asOf) ?? 0))} ${a.quantityUnit} left` : ''}</div></div>
            <div><span className="note">Forecast finish</span><div className={m.slipDays > 0 ? 'bad' : undefined}>{fmtDate(m.forecastFinish)}{m.slipDays > 0 ? ` (+${m.slipDays} working days)` : ''}</div></div>
          </div>
          {m.flags.length > 0 && <ul className="note" style={{ margin: '8px 0 0' }}>{m.flags.map((f) => <li key={f}>{f}</li>)}</ul>}

          {mode === 'progress' && (
            <fieldset className="progress-box">
              <legend>Update actual progress</legend>
              <div className="form-grid">
                <label className="field">Reporting date<input className="input" type="date" max={todayLocal()} value={date} onChange={(e) => setDate(e.target.value)} /></label>
                {!a.actualStart && <label className="field">Actual work start<input className="input" type="date" max={todayLocal()} value={started} onChange={(e) => setStarted(e.target.value)} /></label>}
                {measurable && <label className="field">Verified completed quantity ({a.quantityUnit || 'units'}) <span className="note">of {a.quantityTotal}</span><input className="input" type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} /></label>}
                <label className="field">Actual progress (%) <span className="note">previous {fmtPct(prevPct)}</span>
                  <input className="input" type="number" min="0" max="100" step="0.1" disabled={measurable && qty.trim() !== ''} value={measurable && qty.trim() !== '' && a.quantityTotal ? String(Math.round((Number(qty) / a.quantityTotal) * 1000) / 10) : draftPct} onChange={(e) => setDraftPct(e.target.value)} />
                </label>
                {measurable && qty.trim() === '' && <label className="field" style={{ gridColumn: 'span 2' }}>Why a % instead of quantity (required)<input className="input" value={why} onChange={(e) => setWhy(e.target.value)} /></label>}
                <label className="field">Remaining working days<input className="input" type="number" min="0" step="0.5" value={remaining} onChange={(e) => setRemaining(e.target.value)} placeholder={a.remainingDays != null ? String(a.remainingDays) : 'estimate'} /></label>
                <label className="field" style={{ gridColumn: 'span 2' }}>Site conditions / remarks<input className="input" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></label>
              </div>
              <p className="note">Photos go in <Link href={`/site-evidence?activity=${a.id}`}>Site evidence</Link>. The report is verified through Field reports approval.</p>
              <div className="form-actions"><button className="btn btn-primary" onClick={saveProgress}>Save progress</button><button className="btn" onClick={() => setMode(null)}>Cancel</button></div>
            </fieldset>
          )}

          {(mode === 'stop' || mode === 'restart') && (
            <fieldset className="progress-box">
              <legend>{mode === 'stop' ? 'STOP WORK' : 'RESTART WORK'}</legend>
              <div className="form-grid">
                <label className="field">{mode === 'stop' ? 'Actual stop' : 'Actual restart'} date and time<input className="input" type="datetime-local" max={nowLocal()} value={at} onChange={(e) => setAt(e.target.value)} /></label>
                {mode === 'stop' && (
                  <label className="field">Reason
                    <select className="input" value={stopReason} onChange={(e) => setStopReason(e.target.value as StopReason)}>{STOP_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select>
                  </label>
                )}
                <label className="field">{mode === 'stop' ? 'Responsible supervisor' : 'Supervisor confirming restart'}<input className="input" value={supervisor} onChange={(e) => setSupervisor(e.target.value)} /></label>
                {mode === 'restart' && <label className="field">Remaining working days<input className="input" type="number" min="0" step="0.5" value={remaining} onChange={(e) => setRemaining(e.target.value)} /></label>}
                <label className="field" style={{ gridColumn: 'span 2' }}>Remarks{mode === 'stop' && stopReason === 'other' ? ' (required)' : ''}<input className="input" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></label>
              </div>
              {mode === 'stop' && <label className="note"><input type="checkbox" checked={affects} onChange={(e) => setAffects(e.target.checked)} /> This stoppage affects the approved schedule</label>}
              {mode === 'restart' && (
                <label className="note" style={{ display: 'block' }}>
                  <input type="checkbox" checked={safety} onChange={(e) => setSafety(e.target.checked)} /> Required safety checks, permits and clearances are complete and confirmed on site.
                  The app records this confirmation; it does not authorize work at height or lift a safety hold.
                </label>
              )}
              <p className="note">Add photos or documents in <Link href={`/site-evidence?activity=${a.id}`}>Site evidence</Link>. Stop and restart records cannot be edited or deleted.</p>
              <div className="form-actions">
                <button className={`btn ${mode === 'stop' ? 'btn-danger' : 'btn-primary'}`} onClick={mode === 'stop' ? saveStop : saveRestart}>{mode === 'stop' ? 'Record stop' : 'Record restart'}</button>
                <button className="btn" onClick={() => setMode(null)}>Cancel</button>
              </div>
            </fieldset>
          )}

          {history.length > 0 && (
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table className="tbl">
                <thead><tr><th>Stopped</th><th>Reason</th><th>Supervisor</th><th>Restarted</th><th>Confirmed by</th><th>Remarks</th></tr></thead>
                <tbody>
                  {history.map((s) => (
                    <tr key={s.id}>
                      <td>{when(s.stoppedAt)}</td>
                      <td>{STOP_REASONS.find((r) => r.value === s.reason)?.label ?? s.reason}{s.affectsSchedule ? ' · affects schedule' : ''}</td>
                      <td>{s.supervisor || '—'}</td>
                      <td>{s.restartedAt ? when(s.restartedAt) : <span className="bad">Still stopped</span>}</td>
                      <td>{s.restartSupervisor || '—'}</td>
                      <td className="note">{[s.remarks, s.restartRemarks].filter(Boolean).join(' / ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function latestQty(id: string, reports: FieldReport[], day: string): number | null {
  const r = reports.filter((x) => x.activityId === id && x.date <= day && x.status !== 'rejected' && x.completedQty != null).sort((x, y) => x.date.localeCompare(y.date) || x.createdAt.localeCompare(y.createdAt)).pop();
  return r?.completedQty ?? null;
}
