// Full project report model: cover, location register, executive summary, progress, Gantt schedule,
// site evidence, observations and summary. Pure: everything comes from the records passed in, and
// anything not recorded is reported as such (never guessed).
import { projectProgress, sCurve, type ProgressPoint } from './calc';
import { calendarOf, scopeMetrics, type ScopeMetrics, type WorkCalendar } from './schedule';
import { coverCategoryLabel, gpsSourceShort } from './coverPhotos';
import { accuracyStatus, mapUrl } from './geo';
import type { Activity, ActivityStop, FieldReport, GpsSource, GpsStatus } from './types';
import { STOP_REASONS } from './types';
import type { ReportAudience, ReportPhoto, ReportProject } from './evidenceReport';

export interface CoverItem {
  id: string;
  caption: string;
  category?: string | null;
  ref?: string;
  workArea?: string;
  location?: string;
  lat?: number | null;
  lng?: number | null;
  accuracy?: number | null;
  source?: GpsSource | null;
  status?: GpsStatus | string | null;
  takenAt: string;
  uploadedAt?: string | null;
}

export interface ProjectReportInput {
  audience: ReportAudience;
  project: ReportProject & { manager?: string | null };
  generatedAt: Date;
  preparedBy: string;
  /** reporting cut-off (YYYY-MM-DD) */
  asOf: string;
  periodFrom?: string | null;
  activities: Activity[];
  reports: FieldReport[];
  stops?: ActivityStop[];
  calendar?: WorkCalendar | null;
  cover: CoverItem[];
  evidence: ReportPhoto[];
  /** submitted field reports still waiting for review (internal only) */
  pendingReports?: number;
  timeZone?: string;
  /** client portal: the approved S-curve and overall progress as published, instead of recomputing */
  series?: ProgressPoint[];
  overall?: { planned: number; actual: number } | null;
}

export interface GanttRow { name: string; m: ScopeMetrics; a: Activity }

export interface ProjectReport {
  title: string;
  reference: string;
  fileName: string;
  project: ProjectReportInput['project'];
  audience: ReportAudience;
  asOf: string;
  fields: [string, string][];
  cover: { item: CoverItem; title: string; lines: [string, string][]; mapUrl: string | null }[];
  overall: { planned: number; actual: number; variance: number; status: string } | null;
  series: ProgressPoint[];
  rows: GanttRow[];
  accomplishments: string[];
  outstanding: string[];
  delays: string[];
  observations: string[];
  limitations: string[];
  summary: string[];
  approval: [string, string][];
  evidence: ReportPhoto[];
}

const fmtDay = (d: string, tz: string) => new Intl.DateTimeFormat('en-PH', { timeZone: tz, year: 'numeric', month: 'short', day: '2-digit' }).format(new Date(d.length === 10 ? `${d}T12:00:00Z` : d));
const fmtWhen = (d: string, tz: string) => new Intl.DateTimeFormat('en-PH', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(d));
const clean = (s?: string | null) => (s ?? '').trim();
const pct = (x: number) => `${(Math.round(x * 10) / 10).toFixed(1)}%`;
const pts = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(Math.round(x * 10) / 10).toFixed(1)} pp`;
const dateStamp = (d: Date, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const safeName = (s: string) => s.replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80);

export function scheduleStatus(variance: number): string {
  return variance >= 0 ? 'On or ahead of schedule' : variance > -5 ? 'Slightly behind schedule' : 'Behind schedule';
}

/** Location reference printed under a cover photo. */
export function coverLines(c: CoverItem, n: number, projectName: string, tz = 'Asia/Manila') {
  const has = c.lat != null && c.lng != null && Number.isFinite(c.lat) && Number.isFinite(c.lng);
  const label = coverCategoryLabel(c.category) || clean(c.caption) || 'Site photo';
  const lines: [string, string][] = [
    ['Project', projectName],
    ['Site reference', [c.workArea, c.location].map(clean).filter(Boolean).join(' · ') || clean(c.caption) || 'Not provided'],
    ['Latitude', has ? c.lat!.toFixed(6) : 'GPS Unavailable'],
    ['Longitude', has ? c.lng!.toFixed(6) : 'GPS Unavailable'],
  ];
  if (has) lines.push(['Accuracy', `${c.accuracy != null ? `±${Math.round(c.accuracy)} m · ` : ''}${accuracyStatus(c.accuracy, true)}`]);
  lines.push(['Location source', gpsSourceShort(c.source ?? null, c.status ?? undefined, has)]);
  lines.push(['Captured', fmtWhen(c.takenAt, tz)]);
  if (c.uploadedAt) lines.push(['Uploaded', fmtWhen(c.uploadedAt, tz)]);
  return {
    item: c,
    title: `Photo ${String(n).padStart(2, '0')} — ${label}${clean(c.caption) && clean(c.caption) !== label ? ` · ${clean(c.caption)}` : ''}`,
    lines,
    mapUrl: has ? mapUrl(c.lat, c.lng) : null,
  };
}

export function buildProjectReport(input: ProjectReportInput): ProjectReport {
  const tz = input.timeZone ?? 'Asia/Manila';
  const p = input.project;
  const cal = calendarOf(input.calendar ?? null);
  const acts = input.activities.slice().sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name));
  const stops = input.stops ?? [];
  const day = input.asOf;
  const rows: GanttRow[] = acts.map((a) => ({ name: a.name, a, m: scopeMetrics(a, input.reports, day, cal, stops) }));
  const prog = input.overall !== undefined ? input.overall : acts.length ? projectProgress(acts, input.reports, day, () => input.calendar ?? null) : null;
  const overall = prog ? { planned: prog.planned, actual: prog.actual, variance: prog.actual - prog.planned, status: scheduleStatus(prog.actual - prog.planned) } : null;
  const series = input.series ?? (acts.length ? sCurve(acts, input.reports, () => input.calendar ?? null) : []);
  const from = input.periodFrom ?? (series[0]?.day ?? day);

  const reference = `${p.code}-PR-${dateStamp(input.generatedAt, tz).replace(/-/g, '')}-${new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(input.generatedAt).replace(':', '')}`;
  const fields: [string, string][] = [
    ['Project title', clean(p.name) || 'Not provided'],
    ['Project ID', clean(p.code) || 'Not provided'],
  ];
  if (clean(p.referenceNo)) fields.push(['Client reference', clean(p.referenceNo)]);
  fields.push(['Client', clean(p.client) || 'Not provided']);
  fields.push(['Site', clean(p.site) || 'Not provided']);
  const scope = acts.map((a) => a.name);
  if (scope.length) fields.push(['Scope of work', scope.join('; ')]);
  if (clean(p.manager)) fields.push(['Project manager', clean(p.manager)]);
  if (p.startDate) fields.push(['Project start', fmtDay(p.startDate, tz)]);
  if (p.endDate) fields.push(['Planned completion', fmtDay(p.endDate, tz)]);
  if (clean(p.status)) fields.push(['Project status', clean(p.status)[0].toUpperCase() + clean(p.status).slice(1)]);
  fields.push(['Reporting period', `${fmtDay(from, tz)} – ${fmtDay(day, tz)} (cut-off)`]);
  fields.push(['Report reference', reference]);
  fields.push(['Generated', `${fmtWhen(input.generatedAt.toISOString(), tz)} (${tz})`]);
  fields.push(['Prepared by', clean(input.preparedBy) || 'Not provided']);

  const cover = input.cover.map((c, i) => coverLines(c, i + 1, clean(p.name), tz));

  const inPeriod = (d: string) => d >= from && d <= day;
  const accomplishments: string[] = [];
  for (const r of rows) {
    if (r.m.status === 'Complete') accomplishments.push(`${r.name}: complete${r.a.actualFinish ? ` (${fmtDay(r.a.actualFinish, tz)})` : ''}.`);
    else {
      const recent = input.reports.filter((x) => x.activityId === r.a.id && x.status !== 'rejected' && inPeriod(x.date));
      if (recent.length) accomplishments.push(`${r.name}: progressed to ${pct(r.m.actualPct)} (${recent.length} report${recent.length === 1 ? '' : 's'} in the period).`);
    }
  }
  const outstanding = rows.filter((r) => r.m.status !== 'Complete').map((r) => `${r.name}: ${pct(r.m.actualPct)} done, ${r.m.remainingDays != null ? `${r.m.remainingDays} working days remaining` : 'remaining days not estimated'}, forecast finish ${fmtDay(r.m.forecastFinish, tz)}.`);
  const delays: string[] = [];
  for (const r of rows) {
    if (r.m.status === 'Delayed' || r.m.status === 'Stopped' || r.m.slipDays > 0) {
      delays.push(`${r.name}: ${r.m.status.toLowerCase()}${r.m.slipDays > 0 ? `, forecast ${r.m.slipDays} working day${r.m.slipDays === 1 ? '' : 's'} late` : ''}${clean(r.a.delayReason) ? ` — ${clean(r.a.delayReason)}` : ''}.`);
    }
  }
  for (const s of stops.filter((x) => !x.restartedAt)) {
    const a = acts.find((x) => x.id === s.activityId);
    delays.push(`Blocker: ${a?.name ?? 'activity'} stopped since ${fmtWhen(s.stoppedAt, tz)} (${STOP_REASONS.find((r) => r.value === s.reason)?.label ?? s.reason}).`);
  }

  const observations: string[] = [];
  for (const e of input.evidence.filter((x) => /defect/i.test(x.kind))) observations.push(`Defect recorded${e.ref ? ` (${e.ref})` : ''}: ${clean(e.caption) || 'no description'}${e.workArea ? ` · ${e.workArea}` : ''}.`);
  for (const s of stops) {
    const a = acts.find((x) => x.id === s.activityId);
    observations.push(`Work stoppage on ${a?.name ?? 'activity'}: ${fmtWhen(s.stoppedAt, tz)}${s.restartedAt ? ` to ${fmtWhen(s.restartedAt, tz)}` : ' (still stopped)'} — ${STOP_REASONS.find((r) => r.value === s.reason)?.label ?? s.reason}${clean(s.remarks) ? `; ${clean(s.remarks)}` : ''}.`);
  }
  if (input.audience === 'internal' && input.pendingReports) observations.push(`${input.pendingReports} field report${input.pendingReports === 1 ? ' is' : 's are'} waiting for review.`);

  const limitations: string[] = [];
  const noStart = rows.filter((r) => !r.a.actualStart && r.m.actualPct > 0).length;
  if (noStart) limitations.push(`${noStart} activit${noStart === 1 ? 'y has' : 'ies have'} progress but no recorded actual start date.`);
  const noRem = rows.filter((r) => r.m.status !== 'Complete' && r.a.actualStart && r.m.remainingDays == null).length;
  if (noRem) limitations.push(`${noRem} started activit${noRem === 1 ? 'y has' : 'ies have'} no remaining-days estimate; their forecast uses the planned finish.`);
  const noGps = input.cover.filter((c) => c.lat == null).length + input.evidence.filter((e) => !e.gps).length;
  if (noGps && (input.audience === 'internal' || input.cover.some((c) => c.lat != null) || input.evidence.some((e) => e.gps))) limitations.push(`${noGps} photo${noGps === 1 ? ' has' : 's have'} no GPS location.`);
  if (!acts.length) limitations.push('No schedule activities are available for this report.');
  limitations.push('GPS shows the reported phone position within its accuracy, not the exact surface photographed.');

  const summary: string[] = [];
  if (overall) summary.push(`As of ${fmtDay(day, tz)}, actual progress is ${pct(overall.actual)} against ${pct(overall.planned)} planned (${pts(overall.variance)}): ${overall.status.toLowerCase()}.`);
  summary.push(`${rows.filter((r) => r.m.status === 'Complete').length} of ${rows.length} activities complete; ${delays.length} delay or blocker item${delays.length === 1 ? '' : 's'}; ${outstanding.length} outstanding.`);
  summary.push(`${input.cover.length} cover photo${input.cover.length === 1 ? '' : 's'} and ${input.evidence.length} site evidence photo${input.evidence.length === 1 ? '' : 's'} included.`);

  const approval: [string, string][] = [
    ['Prepared by', clean(input.preparedBy) || 'Not provided'],
    ['Reviewed by', 'Not recorded'],
    ['Approval status', 'Not recorded'],
  ];

  return {
    title: 'Project Report', reference,
    fileName: `NEAS_${safeName(p.code)}_${safeName(p.name)}_Project-Report_${dateStamp(input.generatedAt, tz)}`,
    project: p, audience: input.audience, asOf: day, fields, cover, overall, series, rows,
    accomplishments, outstanding, delays, observations, limitations, summary, approval, evidence: input.evidence,
  };
}
