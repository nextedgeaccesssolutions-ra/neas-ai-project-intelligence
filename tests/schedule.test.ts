import { describe, expect, it } from 'vitest';
import { Calendar, DEFAULT_CALENDAR, localDay, plannedPctWorking, scopeMetrics, weightedProgress, actualPhysicalPct } from '../lib/schedule';
import { plannedPct, projectProgress } from '../lib/calc';
import type { Activity, FieldReport } from '../lib/types';

const monSat = new Calendar({ workDays: [1, 2, 3, 4, 5, 6], exceptions: [{ date: '2026-11-30', kind: 'holiday', name: 'Bonifacio Day' }] });
const act = (o: Partial<Activity> = {}): Activity => ({ id: 'a1', projectId: 'p1', name: 'Facade', start: '2026-11-02', end: '2026-11-11', weight: 60, ...o });
const rep = (o: Partial<FieldReport>): FieldReport => ({ id: Math.random().toString(36), projectId: 'p1', activityId: 'a1', date: '2026-11-06', actualPct: 0, notes: '', createdAt: '2026-11-06T10:00:00Z', ...o });

describe('working-day calendar', () => {
  it('counts inclusive working days, excluding non-working weekdays and holidays', () => {
    // Mon 2 Nov – Wed 11 Nov 2026: 10 calendar days, one Sunday (8 Nov) → 9 working days
    expect(monSat.workingDays('2026-11-02', '2026-11-11')).toBe(9);
    // the 30 Nov holiday (Monday) is excluded
    expect(monSat.workingDays('2026-11-30', '2026-12-05')).toBe(5);
    expect(monSat.workingDays('2026-11-11', '2026-11-02')).toBe(0);
  });
  it('the default 7-day calendar equals calendar days', () => {
    const all = new Calendar(DEFAULT_CALENDAR);
    expect(all.workingDays('2026-11-02', '2026-11-11')).toBe(10);
  });
  it('a declared working day overrides the weekly pattern', () => {
    const c = new Calendar({ workDays: [1, 2, 3, 4, 5], exceptions: [{ date: '2026-11-07', kind: 'working', name: 'Saturday catch-up' }] });
    expect(c.workingDays('2026-11-02', '2026-11-08')).toBe(6);
  });
  it('finds the n-th working day, skipping Sundays and holidays', () => {
    expect(monSat.nthWorkingDay('2026-11-28', 1)).toBe('2026-11-28'); // Saturday works
    expect(monSat.nthWorkingDay('2026-11-28', 2)).toBe('2026-12-01'); // Sun off, Mon 30 holiday
    expect(monSat.nextWorkingDay('2026-11-29')).toBe('2026-12-01');
  });
});

describe('planned progress', () => {
  it('is linear over working days and capped 0–100', () => {
    expect(plannedPctWorking(act(), '2026-11-01', monSat)).toBe(0);
    expect(plannedPctWorking(act(), '2026-11-08', monSat)).toBeCloseTo((6 / 9) * 100, 6); // Sunday adds no progress
    expect(plannedPctWorking(act(), '2026-11-07', monSat)).toBeCloseTo((6 / 9) * 100, 6);
    expect(plannedPctWorking(act(), '2026-12-31', monSat)).toBe(100);
  });
  it('is unchanged for projects on the default calendar', () => {
    const a = { start: '2026-11-01', end: '2026-11-08' };
    expect(plannedPct(a, '2026-11-01')).toBeCloseTo(12.5, 6);
  });
});

describe('actual physical progress', () => {
  it('uses verified quantity ÷ approved quantity (1,000 m², 400 m² done → 40%)', () => {
    const a = act({ quantityTotal: 1000, quantityUnit: 'm2' });
    expect(actualPhysicalPct(a, [rep({ actualPct: 55, completedQty: 400 })], '2026-11-06')).toBe(40);
  });
  it('ignores rejected reports', () => {
    const rs = [rep({ actualPct: 20, date: '2026-11-05' }), rep({ actualPct: 90, date: '2026-11-06', status: 'rejected' })];
    expect(actualPhysicalPct(act(), rs, '2026-11-06')).toBe(20);
  });
});

describe('scope metrics', () => {
  const a = act({ baselineStart: '2026-11-02', baselineEnd: '2026-11-11', start: '2026-11-04', end: '2026-11-13', actualStart: '2026-11-04', remainingDays: 6, quantityTotal: 1000 });
  const m = scopeMetrics(a, [rep({ completedQty: 300, date: '2026-11-07' })], '2026-11-07', monSat);
  it('keeps baseline and current durations apart', () => {
    expect(m.baselineDuration).toBe(9);
    expect(m.currentDuration).toBe(9); // 4–13 Nov minus Sunday 8
  });
  it('counts accumulated actual working days to the cut-off', () => {
    expect(m.actualDays).toBe(4); // Wed–Sat
  });
  it('reports variance in percentage points and time consumption separately', () => {
    expect(m.actualPct).toBe(30);
    expect(m.plannedPct).toBeCloseTo((4 / 9) * 100, 6);
    expect(m.variancePts).toBeCloseTo(30 - (4 / 9) * 100, 6);
    expect(m.timeConsumptionPct).toBeCloseTo((4 / 9) * 100, 6);
  });
  it('forecasts duration and finish from remaining working days on the calendar', () => {
    expect(m.forecastDuration).toBe(10);
    expect(m.forecastFinish).toBe('2026-11-14'); // Mon 9 … Sat 14 = 6 working days
    expect(m.slipDays).toBe(1);
  });
  it('flags time used beyond the planned duration instead of capping it', () => {
    const late = scopeMetrics({ ...a, remainingDays: 3 }, [], '2026-11-20', monSat);
    expect(late.timeConsumptionPct!).toBeGreaterThan(100);
    expect(late.flags).toContain('Time used exceeds planned duration');
    expect(late.status).toBe('Delayed');
  });
  it('shows N/A time consumption when the dates hold no working days', () => {
    const sundayOnly = scopeMetrics(act({ start: '2026-11-08', end: '2026-11-08' }), [], '2026-11-08', monSat);
    expect(sundayOnly.timeConsumptionPct).toBeNull();
  });
  it('uses the actual finish once complete', () => {
    const done = scopeMetrics({ ...a, actualFinish: '2026-11-12' }, [], '2026-11-20', monSat);
    expect(done).toMatchObject({ forecastFinish: '2026-11-12', remainingDays: 0, status: 'Complete' });
  });
});

describe('overall progress', () => {
  it('weights activities by their approved weights, not a simple average', () => {
    expect(weightedProgress([{ weight: 80, planned: 50, actual: 50 }, { weight: 20, planned: 100, actual: 0 }])).toEqual({ planned: 60, actual: 40 });
  });
  it('projectProgress applies each project calendar and quantities', () => {
    const acts = [act({ quantityTotal: 1000 }), act({ id: 'a2', weight: 40 })];
    const p = projectProgress(acts, [rep({ completedQty: 500 }), rep({ activityId: 'a2', actualPct: 100 })], '2026-11-06', () => ({ workDays: [1, 2, 3, 4, 5, 6], exceptions: [] }));
    expect(p.actual).toBeCloseTo(0.6 * 50 + 0.4 * 100, 6);
  });
});

import { activityFromDb, activityToDb, calendarFromDb, calendarToDb, reportToDb } from '../lib/cloud/mapping';
describe('cloud mapping of schedule fields', () => {
  it('sends the baseline only when known, so the database captures it on insert', () => {
    expect(activityToDb(act())).not.toHaveProperty('baseline_start');
    expect(activityToDb(act({ baselineStart: '2026-11-02', baselineEnd: '2026-11-11' }))).toMatchObject({ baseline_start: '2026-11-02', baseline_end: '2026-11-11' });
  });
  it('round-trips actual dates, remaining days and quantities', () => {
    const a = act({ actualStart: '2026-11-03', remainingDays: 4, quantityTotal: 1000, quantityUnit: 'm2', delayReason: 'Rain' });
    const row = { id: a.id, project_id: a.projectId, is_milestone: false, client_visible: false, sort_order: 0, version: 1, deleted_at: null, ...activityToDb(a) };
    expect(activityFromDb(row)).toMatchObject({ actualStart: '2026-11-03', actualFinish: null, remainingDays: 4, quantityTotal: 1000, quantityUnit: 'm2', delayReason: 'Rain' });
    expect(reportToDb(rep({ completedQty: 400 }))).toMatchObject({ completed_qty: 400 });
  });
  it('round-trips a project calendar', () => {
    const c = { workDays: [1, 2, 3, 4, 5, 6], exceptions: [{ date: '2026-11-30', kind: 'holiday' as const, name: 'Bonifacio Day' }], hoursPerDay: 8, timeZone: 'Asia/Manila' };
    expect(calendarFromDb(calendarToDb('p1', c))).toEqual(c);
  });
});

import type { ActivityStop } from '../lib/types';
const stop = (o: Partial<ActivityStop>): ActivityStop => ({ id: 's1', projectId: 'p1', activityId: 'a1', stoppedAt: '2026-11-04T10:00:00+08:00', reason: 'weather', remarks: '', supervisor: 'R. Santos', affectsSchedule: true, restartedAt: null, restartSupervisor: '', restartRemarks: '', safetyCleared: false, remainingDays: null, ...o });
describe('stop and restart', () => {
  const a = act({ actualStart: '2026-11-02', remainingDays: 5 });
  it('marks an open stoppage as Stopped and stops counting worked days', () => {
    const m = scopeMetrics(a, [], '2026-11-07', monSat, [stop({})]);
    expect(m.status).toBe('Stopped');
    expect(m.grossDays).toBe(6); // Mon 2 – Sat 7
    expect(m.stoppedDays).toBe(3); // Thu 5 – Sat 7 lost; the stop day counts as worked
    expect(m.actualDays).toBe(3);
    expect(m.flags.some((f) => f.startsWith('Stopped since 2026-11-04'))).toBe(true);
  });
  it('keeps several stop/restart cycles and counts only the days lost', () => {
    const cycles = [
      stop({ restartedAt: '2026-11-06T08:00:00+08:00', safetyCleared: true }),
      stop({ id: 's2', stoppedAt: '2026-11-09T13:00:00+08:00', restartedAt: '2026-11-11T08:00:00+08:00', safetyCleared: true, remainingDays: 2 }),
    ];
    const m = scopeMetrics({ ...a, remainingDays: null, end: '2026-11-20' }, [rep({ actualPct: 60, date: '2026-11-10' })], '2026-11-11', monSat, cycles);
    expect(m.stoppedDays).toBe(2); // Thu 5 and Tue 10
    expect(m.actualDays).toBe(m.grossDays! - 2);
    expect(m.status).toBe('Restarted');
    expect(m.remainingDays).toBe(2); // estimate recorded at the restart
  });
  it('a schedule change alone never changes actual progress', () => {
    const r = [rep({ completedQty: 250, date: '2026-11-03' })];
    const before = scopeMetrics(act({ quantityTotal: 1000 }), r, '2026-11-05', monSat);
    const after = scopeMetrics(act({ quantityTotal: 1000, start: '2026-11-09', end: '2026-11-20', baselineStart: '2026-11-02', baselineEnd: '2026-11-11' }), r, '2026-11-05', monSat);
    expect(after.actualPct).toBe(25);
    expect(after.actualPct).toBe(before.actualPct);
  });
});

describe('stop dates use the project time zone', () => {
  it('a 07:00 Manila stop belongs to that Manila day, not the UTC day before', () => {
    expect(localDay('2026-10-23T23:00:00.000Z')).toBe('2026-10-24');
    const m = scopeMetrics(act({ actualStart: '2026-11-02', remainingDays: 5 }), [], '2026-11-07', monSat, [stop({ stoppedAt: '2026-11-04T23:00:00.000Z' })]);
    expect(m.stoppedDays).toBe(2); // stop day Thu 5 (Manila) counts as worked; Fri 6 and Sat 7 lost
  });
});
