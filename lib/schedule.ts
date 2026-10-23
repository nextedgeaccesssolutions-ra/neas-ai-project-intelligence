// Working-day calendar and per-scope schedule metrics. Pure functions; dates are YYYY-MM-DD, inclusive.
import type { Activity, FieldReport } from './types';

const DAY = 86_400_000;
const ms = (d: string) => Date.parse(d.slice(0, 10) + 'T00:00:00Z');
const iso = (n: number) => new Date(n).toISOString().slice(0, 10);
const add = (d: string, n: number) => iso(ms(d) + n * DAY);

export type CalendarExceptionKind = 'holiday' | 'shutdown' | 'non_working' | 'working';
export interface CalendarException { date: string; kind: CalendarExceptionKind; name: string }
export interface WorkCalendar {
  /** ISO weekdays worked: 1 = Monday … 7 = Sunday */
  workDays: number[];
  exceptions: CalendarException[];
  hoursPerDay?: number;
  timeZone?: string;
}
/** NEAS default: every day is a working day; holidays and shutdowns are added per project. */
export const DEFAULT_CALENDAR: WorkCalendar = { workDays: [1, 2, 3, 4, 5, 6, 7], exceptions: [], hoursPerDay: 8, timeZone: 'Asia/Manila' };

const isoWeekday = (d: string) => { const w = new Date(ms(d)).getUTCDay(); return w === 0 ? 7 : w; };

/** Compiled calendar for fast repeated lookups. */
export class Calendar {
  private days: Set<number>;
  private off = new Set<string>();
  private on = new Set<string>();
  constructor(readonly def: WorkCalendar = DEFAULT_CALENDAR) {
    this.days = new Set(def.workDays.length ? def.workDays : DEFAULT_CALENDAR.workDays);
    for (const e of def.exceptions ?? []) (e.kind === 'working' ? this.on : this.off).add(e.date.slice(0, 10));
  }
  isWorkingDay(d: string): boolean {
    if (this.on.has(d)) return true;
    if (this.off.has(d)) return false;
    return this.days.has(isoWeekday(d));
  }
  /** Working days from `a` to `b`, both inclusive (0 when b < a). */
  workingDays(a: string, b: string): number {
    if (b < a) return 0;
    const total = Math.round((ms(b) - ms(a)) / DAY) + 1;
    // whole weeks in bulk, then the remainder and the exceptions inside the range
    const weeks = Math.floor(total / 7);
    let n = weeks * this.days.size;
    for (let i = weeks * 7; i < total; i++) if (this.days.has(isoWeekday(add(a, i)))) n++;
    for (const d of this.off) if (d >= a && d <= b && this.days.has(isoWeekday(d)) && !this.on.has(d)) n--;
    for (const d of this.on) if (d >= a && d <= b && !this.days.has(isoWeekday(d))) n++;
    return n;
  }
  nextWorkingDay(d: string): string {
    let x = d;
    for (let i = 0; i < 3660; i++) { if (this.isWorkingDay(x)) return x; x = add(x, 1); }
    return d;
  }
  /** The date of the n-th working day counting `from` as day 1 when it is a working day (n ≥ 1). */
  nthWorkingDay(from: string, n: number): string {
    let x = this.nextWorkingDay(from);
    for (let k = 1; k < Math.max(1, Math.ceil(n)); k++) x = this.nextWorkingDay(add(x, 1));
    return x;
  }
}

const cache = new WeakMap<WorkCalendar, Calendar>();
export const calendarOf = (def?: WorkCalendar | null): Calendar => {
  const d = def ?? DEFAULT_CALENDAR;
  let c = cache.get(d);
  if (!c) { c = new Calendar(d); cache.set(d, c); }
  return c;
};

// ---------------- progress ----------------

/** Planned % at the END of `day`, linear over the activity's working days (capped 0–100). */
export function plannedPctWorking(a: Pick<Activity, 'start' | 'end'>, day: string, cal: Calendar): number {
  if (day < a.start) return 0;
  if (day >= a.end) return 100;
  const dur = cal.workingDays(a.start, a.end);
  if (dur <= 0) return 0;
  return Math.min(100, (cal.workingDays(a.start, day) / dur) * 100);
}

/** Latest report on or before `day` that has not been rejected (latest date, then latest saved). */
export function latestUsableReport(activityId: string, reports: FieldReport[], day = '9999-12-31'): FieldReport | null {
  let best: FieldReport | null = null;
  for (const r of reports) {
    if (r.activityId !== activityId || r.date > day || r.status === 'rejected') continue;
    if (!best || r.date > best.date || (r.date === best.date && r.createdAt > best.createdAt)) best = r;
  }
  return best;
}

const clamp = (x: number) => Math.min(100, Math.max(0, Number.isFinite(x) ? x : 0));

/**
 * Actual physical % on `day`: verified completed quantity ÷ approved scope quantity for measurable
 * scopes, otherwise the reported cumulative %.
 */
export function actualPhysicalPct(a: Pick<Activity, 'id' | 'quantityTotal'>, reports: FieldReport[], day: string): number {
  const r = latestUsableReport(a.id, reports, day);
  if (!r) return 0;
  if (a.quantityTotal && a.quantityTotal > 0 && r.completedQty != null) return clamp((r.completedQty / a.quantityTotal) * 100);
  return clamp(r.actualPct);
}

export interface ScopeMetrics {
  baselineDuration: number | null;
  currentDuration: number;
  /** working days from actual start to the cut-off (or actual finish) */
  actualDays: number | null;
  remainingDays: number | null;
  plannedPct: number;
  actualPct: number;
  /** percentage points: actual − planned */
  variancePts: number;
  /** null = N/A (no duration); may exceed 100 */
  timeConsumptionPct: number | null;
  forecastDuration: number | null;
  forecastFinish: string;
  /** forecast finish vs current planned finish, in working days (+ = late) */
  slipDays: number;
  status: 'Not started' | 'In progress' | 'Complete' | 'Overdue' | 'Behind';
  flags: string[];
}

/** All schedule metrics for one scope at the reporting cut-off `day`. */
export function scopeMetrics(a: Activity, reports: FieldReport[], day: string, cal: Calendar): ScopeMetrics {
  const flags: string[] = [];
  const baselineDuration = a.baselineStart && a.baselineEnd ? cal.workingDays(a.baselineStart, a.baselineEnd) : null;
  const currentDuration = cal.workingDays(a.start, a.end);
  const planned = plannedPctWorking(a, day, cal);
  const actual = actualPhysicalPct(a, reports, day);
  const done = !!a.actualFinish && a.actualFinish <= day;
  const started = !!a.actualStart && a.actualStart <= day;
  const actualDays = started ? cal.workingDays(a.actualStart!, done ? a.actualFinish! : day) : null;
  const remaining = done ? 0 : a.remainingDays ?? null;

  let forecastFinish: string;
  if (done) forecastFinish = a.actualFinish!;
  else if (started && remaining != null) forecastFinish = remaining > 0 ? cal.nthWorkingDay(day < a.actualStart! ? a.actualStart! : addDay(day), remaining) : day;
  else if (!started && remaining != null && remaining > 0) forecastFinish = cal.nthWorkingDay(day >= a.start ? addDay(day) : a.start, remaining);
  else forecastFinish = a.end;
  const forecastDuration = started && remaining != null ? (actualDays ?? 0) + remaining : !started && remaining != null ? remaining : null;

  const timeConsumptionPct = currentDuration > 0 && actualDays != null ? (actualDays / currentDuration) * 100 : currentDuration > 0 ? 0 : null;
  if (currentDuration <= 0) flags.push('No working days in the planned dates');
  if (timeConsumptionPct != null && timeConsumptionPct > 100 && !done) flags.push('Time used exceeds planned duration');
  if (!started && day > a.start && actual === 0) flags.push('Planned start passed without an actual start');
  if (started && remaining == null && !done) flags.push('Remaining working days not estimated');
  if (a.quantityTotal && !reports.some((r) => r.activityId === a.id && r.completedQty != null && r.status !== 'rejected')) flags.push('No verified quantity reported');

  const slipDays = forecastFinish > a.end ? cal.workingDays(addDay(a.end), forecastFinish) : -cal.workingDays(addDay(forecastFinish), a.end);
  const status: ScopeMetrics['status'] = done || actual >= 100 ? 'Complete'
    : day > a.end ? 'Overdue'
    : actual + 5 < planned ? 'Behind'
    : started || actual > 0 ? 'In progress' : 'Not started';

  return {
    baselineDuration, currentDuration, actualDays, remainingDays: remaining, plannedPct: planned, actualPct: actual,
    variancePts: actual - planned, timeConsumptionPct, forecastDuration, forecastFinish, slipDays, status, flags,
  };
}
const addDay = (d: string) => add(d, 1);

/** Weighted overall progress: Σ(weight × %) ÷ Σ(weight); planned and actual on the same basis. */
export function weightedProgress(items: { weight: number; planned: number; actual: number }[]): { planned: number; actual: number } {
  const w = items.reduce((s, x) => s + (x.weight > 0 ? x.weight : 0), 0);
  if (w <= 0) return { planned: 0, actual: 0 };
  return {
    planned: items.reduce((s, x) => s + (x.weight > 0 ? x.weight * x.planned : 0), 0) / w,
    actual: items.reduce((s, x) => s + (x.weight > 0 ? x.weight * x.actual : 0), 0) / w,
  };
}
