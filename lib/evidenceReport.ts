// Site Evidence report model: title page, photo pages (2 × 4 or 2 × 6) and summary. Pure functions;
// the PDF / PowerPoint / Word renderers in evidenceExport.ts only draw what this builds.
// Every value comes from the project record or the photos themselves; missing values are omitted
// or shown as "Not provided", never guessed.

export type ReportKind = 'site_evidence' | 'before_after' | 'inspection' | 'safety' | 'defect';
export type ReportLayout = '2x4' | '2x6';
export type ReportAudience = 'internal' | 'client';

export const REPORT_KINDS: { value: ReportKind; label: string; code: string; kinds: string[] | null }[] = [
  { value: 'site_evidence', label: 'Site Evidence Report', code: 'SER', kinds: null },
  { value: 'before_after', label: 'Before-and-After Report', code: 'BAR', kinds: ['before', 'after'] },
  { value: 'inspection', label: 'Inspection Report', code: 'INR', kinds: ['inspection'] },
  { value: 'safety', label: 'Safety Report', code: 'SFR', kinds: ['safety'] },
  { value: 'defect', label: 'Defect Report', code: 'DFR', kinds: ['defect'] },
];

export const PER_PAGE: Record<ReportLayout, number> = { '2x4': 8, '2x6': 12 };
export const NOT_PROVIDED = 'Not provided';
export const COMPANY = 'NextEdge Access Solutions';

export interface ReportProject {
  code: string;
  name: string;
  client?: string | null;
  site?: string | null;
  referenceNo?: string | null;
  status?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}

export interface ReportPhoto {
  id: string;
  kind: string;
  caption: string;
  takenAt: string;
  ref?: string;
  activity?: string;
  workArea?: string;
  location?: string;
  /** "14.585771, 121.029367 ±10 m"; only present when the viewer may see locations */
  gps?: string;
  /** where the location came from, e.g. "Device position recorded during capture" */
  gpsSource?: string;
  pairId?: string | null;
}

export interface ReportInput {
  kind: ReportKind;
  layout: ReportLayout;
  audience: ReportAudience;
  project: ReportProject;
  photos: ReportPhoto[];
  preparedBy: string;
  generatedAt: Date;
  /** optional capture-date filter (YYYY-MM-DD, inclusive) */
  from?: string;
  to?: string;
  timeZone?: string;
  /** client portal files carry upload times, not capture times */
  datesAre?: 'captured' | 'uploaded';
}

export interface Report {
  title: string;
  reference: string;
  fileName: string;
  project: ReportProject;
  /** label/value rows of the title page, in order */
  fields: [string, string][];
  photos: ReportPhoto[];
  pages: ReportPhoto[][];
  cols: number;
  rows: number;
  cover: ReportPhoto | null;
  summary: { label: string; value: string }[];
  findings: string[];
  audience: ReportAudience;
  datesAre: 'captured' | 'uploaded';
  /** false when the viewer is not shown locations at all (client portal with locations switched off) */
  locations: boolean;
}

const fmtDay = (d: string, tz: string) => new Intl.DateTimeFormat('en-PH', { timeZone: tz, year: 'numeric', month: 'short', day: '2-digit' }).format(new Date(d.length === 10 ? `${d}T12:00:00Z` : d));
const dayOf = (iso: string, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const stamp = (d: Date, tz: string) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}${p.month}${p.day}-${p.hour === '24' ? '00' : p.hour}${p.minute}`;
};
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1).replace(/_/g, ' ') : s);
const clean = (s?: string | null) => (s ?? '').trim();
const safeName = (s: string) => s.replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

/** Builds the full report. Throws when no photo matches, so an empty report is never produced. */
export function buildReport(input: ReportInput): Report {
  const tz = input.timeZone ?? 'Asia/Manila';
  const def = REPORT_KINDS.find((k) => k.value === input.kind)!;
  const photos = input.photos
    .filter((p) => !def.kinds || def.kinds.includes(p.kind.toLowerCase()))
    .filter((p) => (!input.from || dayOf(p.takenAt, tz) >= input.from) && (!input.to || dayOf(p.takenAt, tz) <= input.to))
    .slice()
    .sort((a, b) => a.takenAt.localeCompare(b.takenAt));
  if (!photos.length) throw new Error(`No ${def.kinds ? def.kinds.join(' / ') + ' ' : ''}photos match this report${input.from || input.to ? ' and date range' : ''}.`);

  const days = photos.map((p) => dayOf(p.takenAt, tz));
  const first = days[0], last = days[days.length - 1];
  const period = first === last ? fmtDay(first, tz) : `${fmtDay(first, tz)} – ${fmtDay(last, tz)}`;
  const reference = `${input.project.code}-${def.code}-${stamp(input.generatedAt, tz)}`;
  const p = input.project;
  const scope = [...new Set(photos.map((x) => clean(x.activity)).filter(Boolean))];
  const areas = [...new Set(photos.map((x) => clean(x.workArea)).filter(Boolean))];

  const fields: [string, string][] = [
    ['Project title', clean(p.name) || NOT_PROVIDED],
    ['Project ID', clean(p.code) || NOT_PROVIDED],
  ];
  if (clean(p.referenceNo)) fields.push(['Client reference', clean(p.referenceNo)]);
  fields.push(['Client', clean(p.client) || NOT_PROVIDED]);
  fields.push(['Site', clean(p.site) || NOT_PROVIDED]);
  if (p.startDate) fields.push(['Project start', fmtDay(p.startDate, tz)]);
  if (p.endDate) fields.push(['Planned completion', fmtDay(p.endDate, tz)]);
  if (clean(p.status)) fields.push(['Project status', cap(clean(p.status))]);
  if (scope.length) fields.push(['Scope of work', scope.join('; ')]);
  if (areas.length) fields.push(['Work areas', areas.join('; ')]);
  const uploaded = input.datesAre === 'uploaded';
  fields.push([uploaded ? 'Reporting period (upload dates)' : 'Reporting period', period]);
  fields.push(['Report reference', reference]);
  fields.push(['Generated', `${new Intl.DateTimeFormat('en-PH', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }).format(input.generatedAt)} (${tz})`]);
  fields.push(['Prepared by', clean(input.preparedBy) || NOT_PROVIDED]);

  const per = PER_PAGE[input.layout];
  const pages: ReportPhoto[][] = [];
  for (let i = 0; i < photos.length; i += per) pages.push(photos.slice(i, i + per));
  const cover = photos.slice().reverse().find((x) => x.kind.toLowerCase() === 'after') ?? photos[photos.length - 1];

  const byKind = new Map<string, number>();
  for (const x of photos) byKind.set(cap(x.kind.toLowerCase()), (byKind.get(cap(x.kind.toLowerCase())) ?? 0) + 1);
  const summary = [
    { label: 'Photos in report', value: String(photos.length) },
    { label: 'By type', value: [...byKind].map(([k, n]) => `${k} ${n}`).join(' · ') },
    { label: uploaded ? 'Upload period' : 'Capture period', value: period },
  ];
  const findings: string[] = [];
  const pairs = new Set(photos.filter((x) => x.pairId && photos.some((y) => y.id === x.pairId)).map((x) => [x.id, x.pairId].sort().join()));
  if (pairs.size) findings.push(`${pairs.size} before-and-after pair${pairs.size === 1 ? '' : 's'} documented.`);
  if (input.audience === 'internal' || photos.some((x) => x.gps)) {
    const located = photos.filter((x) => x.gps).length;
    summary.push({ label: 'GPS-tagged', value: `${located} of ${photos.length}` });
    if (located < photos.length) findings.push(`${photos.length - located} photo${photos.length - located === 1 ? ' has' : 's have'} no GPS location.`);
  }
  for (const a of scope) findings.push(`${a}: ${photos.filter((x) => clean(x.activity) === a).length} photo(s).`);
  const defects = byKind.get('Defect') ?? 0, safety = byKind.get('Safety') ?? 0;
  if (defects) findings.push(`${defects} defect photo${defects === 1 ? '' : 's'} recorded; see captions for details.`);
  if (safety) findings.push(`${safety} safety photo${safety === 1 ? '' : 's'} recorded.`);

  return {
    title: def.label, reference, fileName: safeName(`${p.code} ${def.label} ${stamp(input.generatedAt, tz)}`),
    project: p, fields, photos, pages, cols: 2, rows: per / 2, cover, summary, findings, audience: input.audience, datesAre: uploaded ? 'uploaded' : 'captured', locations: input.audience === 'internal' || photos.some((x) => x.gps),
  };
}

/** Caption lines under a photo. Location comes only from the photo record (clients get it only when the project shares it). */
export function photoCaption(x: ReportPhoto, audience: ReportAudience, tz = 'Asia/Manila', datesAre: 'captured' | 'uploaded' = 'captured', n?: number, locations = true): string[] {
  const when = (datesAre === 'uploaded' ? 'Uploaded ' : '') + new Intl.DateTimeFormat('en-PH', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(x.takenAt));
  const head = [n != null ? `Photo ${n}` : '', clean(x.ref), cap(x.kind.toLowerCase())].filter(Boolean).join(' · ');
  const lines = [head, clean(x.caption), [when, clean(x.activity), clean(x.workArea), clean(x.location)].filter(Boolean).join(' · ')];
  if (x.gps) lines.push(`GPS ${x.gps}${x.gpsSource ? ` · ${x.gpsSource}` : ''}`);
  else if (locations) lines.push('GPS unavailable');
  return lines.filter(Boolean);
}
