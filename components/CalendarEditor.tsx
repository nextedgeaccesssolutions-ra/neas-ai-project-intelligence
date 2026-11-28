'use client';
// Project working calendar: working weekdays plus holidays, shutdowns and extra working days.
import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { fmtDate } from '@/lib/format';
import type { CalendarException, CalendarExceptionKind, WorkCalendar } from '@/lib/schedule';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const KINDS: { value: CalendarExceptionKind; label: string }[] = [
  { value: 'holiday', label: 'Holiday' },
  { value: 'shutdown', label: 'Shutdown' },
  { value: 'non_working', label: 'Non-working day' },
  { value: 'working', label: 'Extra working day' },
];

export default function CalendarEditor({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const { calendarFor, setCalendar } = useStore();
  const saved = calendarFor(projectId);
  const [cal, setCal] = useState<WorkCalendar>(saved);
  const [ex, setEx] = useState<CalendarException>({ date: '', kind: 'holiday', name: '' });
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => setCal(saved), [saved, projectId]);

  const dirty = JSON.stringify(cal) !== JSON.stringify(saved);
  const toggle = (d: number) => setCal({ ...cal, workDays: cal.workDays.includes(d) ? cal.workDays.filter((x) => x !== d) : [...cal.workDays, d].sort() });
  const addEx = () => {
    if (!ex.date) return setMsg('Choose a date.');
    setCal({ ...cal, exceptions: [...cal.exceptions.filter((e) => e.date !== ex.date), { ...ex, name: ex.name.trim() || KINDS.find((k) => k.value === ex.kind)!.label }].sort((a, b) => a.date.localeCompare(b.date)) });
    setEx({ date: '', kind: 'holiday', name: '' });
    setMsg(null);
  };
  const save = () => {
    if (!cal.workDays.length) return setMsg('At least one weekday must be a working day.');
    setCalendar(projectId, cal);
    setMsg('Calendar saved. Planned %, durations and forecasts now use it.');
  };

  return (
    <section className="card" id="calendar-card">
      <div className="card-head">
        <h2>Working calendar</h2>
        <span className="note">{cal.workDays.length} working days a week · {cal.exceptions.length} exception{cal.exceptions.length === 1 ? '' : 's'}</span>
      </div>
      <div className="form-actions" style={{ marginTop: 0, flexWrap: 'wrap' }} role="group" aria-label="Working weekdays">
        {DAYS.map((label, i) => {
          const on = cal.workDays.includes(i + 1);
          return (
            <button key={label} className={`btn btn-sm ${on ? 'btn-primary' : ''}`} aria-pressed={on} disabled={!canEdit} onClick={() => toggle(i + 1)}>{label}</button>
          );
        })}
      </div>
      {cal.exceptions.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="tbl">
            <thead><tr><th>Date</th><th>Type</th><th>Name</th>{canEdit && <th />}</tr></thead>
            <tbody>
              {cal.exceptions.map((e) => (
                <tr key={e.date}>
                  <td>{fmtDate(e.date)}</td>
                  <td>{KINDS.find((k) => k.value === e.kind)?.label ?? e.kind}</td>
                  <td>{e.name}</td>
                  {canEdit && <td><button className="btn btn-sm btn-danger" onClick={() => setCal({ ...cal, exceptions: cal.exceptions.filter((x) => x.date !== e.date) })}>Remove</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canEdit && (
        <>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <label className="field">Date<input className="input" type="date" value={ex.date} onChange={(e) => setEx({ ...ex, date: e.target.value })} /></label>
            <label className="field">Type
              <select className="input" value={ex.kind} onChange={(e) => setEx({ ...ex, kind: e.target.value as CalendarExceptionKind })}>
                {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
            </label>
            <label className="field">Name<input className="input" value={ex.name} onChange={(e) => setEx({ ...ex, name: e.target.value })} placeholder="e.g. Bonifacio Day" /></label>
          </div>
          <div className="form-actions">
            <button className="btn" onClick={addEx}>Add date</button>
            <button className="btn btn-primary" disabled={!dirty} onClick={save}>Save calendar</button>
          </div>
        </>
      )}
      {msg && <p className="note" role="status">{msg}</p>}
    </section>
  );
}
