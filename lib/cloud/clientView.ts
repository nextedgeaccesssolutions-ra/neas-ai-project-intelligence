// Turns the database's client snapshot into the client portal view model.
// Pure function: no costs or staff data can appear because the input never contains them.
import { projectProgress, sCurve, type ProgressPoint } from '../calc';
import type { Activity, FieldReport } from '../types';

export interface SnapshotInput {
  project: { code: string; name: string; status: string; client?: string; site?: string; reference_no?: string; start_date?: string; end_date?: string };
  visibility: Record<string, boolean>;
  session_expires_at: string;
  generated_at: string;
  activities?: { id: string; name: string; start_date: string; end_date: string; weight: number; is_milestone: boolean }[];
  progress?: { activity_id: string; report_date: string; actual_pct: number }[];
  reports?: { report_date: string; report_type: string; activity: string | null; actual_pct: number | null; notes: string }[];
  files?: { id: string; kind: string; caption: string; storage_path: string; mime_type: string; created_at: string }[];
}

export interface ClientView {
  project: SnapshotInput['project'];
  visibility: Record<string, boolean>;
  asOf: string;
  generatedAt: string;
  sessionExpiresAt: string;
  progress?: { planned: number; actual: number };
  completion?: { complete: boolean; actual: number };
  milestones?: { name: string; date: string; done: boolean }[];
  gantt?: { id: string; name: string; start: string; end: string; weight: number; actual: number }[];
  scurve?: ProgressPoint[];
  reports?: SnapshotInput['reports'];
  files?: { id: string; kind: string; caption: string; mime: string; url: string | null; createdAt: string }[];
}

export function buildClientView(s: SnapshotInput, asOf: string, signed: Record<string, string> = {}): ClientView {
  const v = s.visibility ?? {};
  const acts: Activity[] = (s.activities ?? []).map((a) => ({ id: a.id, projectId: s.project.code, name: a.name, start: a.start_date, end: a.end_date, weight: Number(a.weight) }));
  const reps: FieldReport[] = (s.progress ?? []).map((p, i) => ({ id: `p${i}`, projectId: s.project.code, activityId: p.activity_id, date: p.report_date, actualPct: Number(p.actual_pct), notes: '', createdAt: `${p.report_date}T00:00:${String(i % 60).padStart(2, '0')}Z` }));
  const prog = projectProgress(acts, reps, asOf);
  const latest = (id: string) => {
    const r = reps.filter((x) => x.activityId === id && x.date <= asOf).sort((a, b) => a.date.localeCompare(b.date)).pop();
    return r ? r.actualPct : 0;
  };
  const view: ClientView = { project: s.project, visibility: v, asOf, generatedAt: s.generated_at, sessionExpiresAt: s.session_expires_at };
  if (v.show_progress) view.progress = { planned: prog.planned, actual: prog.actual };
  if (v.show_completion) view.completion = { complete: prog.actual >= 99.95, actual: prog.actual };
  if (v.show_milestones) view.milestones = (s.activities ?? []).filter((a) => a.is_milestone).map((a) => ({ name: a.name, date: a.end_date, done: latest(a.id) >= 100 }));
  if (v.show_gantt) view.gantt = acts.map((a) => ({ id: a.id, name: a.name, start: a.start, end: a.end, weight: a.weight, actual: latest(a.id) }));
  if (v.show_scurve) view.scurve = sCurve(acts, reps);
  if (v.show_reports) view.reports = s.reports ?? [];
  if (v.show_photos || v.show_documents)
    view.files = (s.files ?? []).map((f) => ({ id: f.id, kind: f.kind, caption: f.caption, mime: f.mime_type, url: signed[f.storage_path] ?? null, createdAt: f.created_at }));
  return view;
}

export function todayIn(tz: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return parts; // en-CA formats as YYYY-MM-DD
}
