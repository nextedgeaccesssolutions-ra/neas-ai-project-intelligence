// Database rows (neas schema) ⇄ the app's in-memory model. Pure functions.
import type { Activity, AppState, BoqLine, CostSettings, Evidence, FieldReport, Project, ProjectStatus, Quotation } from '../types';

export interface DbProject { id: string; code: string; name: string; reference_no: string; client_name: string; site: string; status: string; start_date: string | null; end_date: string | null; contract_value: number | string | null; client_portal_enabled: boolean; version: number; created_at: string }
export interface DbActivity { id: string; project_id: string; name: string; start_date: string; end_date: string; weight: number | string; is_milestone: boolean; client_visible: boolean; sort_order: number; version: number; deleted_at: string | null }
export interface DbReport { id: string; project_id: string; activity_id: string | null; report_type: string; report_date: string; actual_pct: number | string | null; notes: string; status: string; client_visible: boolean; submitted_by: string | null; version: number; created_at: string; deleted_at: string | null }
export interface DbBoq { id: string; project_id: string; item: string; description: string; category: string; unit: string; qty: number | string; unit_cost: number | string; version: number; deleted_at: string | null }
export interface DbCost { id: string; project_id: string; overhead_pct: number | string; contingency_pct: number | string; insurance_pct: number | string; bond_pct: number | string; warranty_pct: number | string; markup_pct: number | string; vat_pct: number | string; vat_mode: string; version: number }
export interface DbQuote { id: string; project_id: string; number: string; status: string; validity_days: number; terms: string; approved_by: string | null; approved_at: string | null; issued_at: string | null; approved_total: number | string | null; history: Quotation['history']; version: number }
export interface DbAttachment {
  id: string; project_id: string; report_id: string | null; activity_id: string | null; kind: string; storage_path: string; caption: string; mime_type: string; bytes: number; client_visible: boolean; created_at: string; version: number; deleted_at: string | null;
  captured_at?: string | null; gps_lat?: number | string | null; gps_lng?: number | string | null; gps_accuracy_m?: number | string | null; gps_altitude_m?: number | string | null; gps_heading?: number | string | null; gps_captured_at?: string | null; gps_status?: string | null;
  work_area?: string | null; location_detail?: string | null; pair_id?: string | null; photo_ref?: string | null;
}

const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const STATUS_MAP: Record<string, ProjectStatus> = { draft: 'draft', active: 'active', suspended: 'on-hold', completed: 'completed', archived: 'completed' };

export const projectFromDb = (p: DbProject): Project => ({
  id: p.id, code: p.code, name: p.name, client: p.client_name, site: p.site, status: STATUS_MAP[p.status] ?? 'active',
  contractValue: p.contract_value == null ? null : num(p.contract_value), createdAt: p.created_at,
});
export const activityFromDb = (a: DbActivity): Activity => ({ id: a.id, projectId: a.project_id, name: a.name, start: a.start_date, end: a.end_date, weight: num(a.weight) });
export const reportFromDb = (r: DbReport): FieldReport => ({ id: r.id, projectId: r.project_id, activityId: r.activity_id ?? '', date: r.report_date, actualPct: num(r.actual_pct), notes: r.notes, createdAt: r.created_at, status: r.status as FieldReport['status'], clientVisible: r.client_visible });
export const boqFromDb = (b: DbBoq): BoqLine => ({ id: b.id, projectId: b.project_id, item: b.item, description: b.description, category: b.category as BoqLine['category'], unit: b.unit, qty: num(b.qty), unitCost: num(b.unit_cost) });
export const costFromDb = (c: DbCost): CostSettings => ({ overheadPct: num(c.overhead_pct), contingencyPct: num(c.contingency_pct), insurancePct: num(c.insurance_pct), bondPct: num(c.bond_pct), warrantyPct: num(c.warranty_pct), markupPct: num(c.markup_pct), vatPct: num(c.vat_pct), vatMode: c.vat_mode === 'exempt' ? 'exempt' : 'exclusive' });
export const quoteFromDb = (q: DbQuote): Quotation => ({ projectId: q.project_id, number: q.number, status: q.status as Quotation['status'], validityDays: q.validity_days, terms: q.terms, approvedBy: q.approved_by, approvedAt: q.approved_at, issuedAt: q.issued_at, approvedTotal: q.approved_total == null ? null : num(q.approved_total), history: q.history ?? [] });
const KIND_FROM_DB: Record<string, Evidence['kind']> = { before: 'Before', after: 'After', during: 'During', inspection: 'Inspection', safety: 'Safety', defect: 'Defect' };
const optNum = (v: unknown) => (v == null || v === '' ? null : Number(v));
export const evidenceFromDb = (f: DbAttachment): Evidence => {
  const lat = optNum(f.gps_lat), lng = optNum(f.gps_lng);
  return {
    id: f.id, projectId: f.project_id, activityId: f.activity_id ?? '', kind: KIND_FROM_DB[f.kind] ?? 'During', caption: f.caption,
    takenAt: f.captured_at ?? f.created_at, bytes: f.bytes, storagePath: f.storage_path,
    gps: lat != null && lng != null ? { lat, lng, accuracy: optNum(f.gps_accuracy_m), altitude: optNum(f.gps_altitude_m), heading: optNum(f.gps_heading), at: f.gps_captured_at ?? f.captured_at ?? f.created_at } : null,
    gpsStatus: (f.gps_status as Evidence['gpsStatus']) ?? 'not_requested',
    workArea: f.work_area ?? '', locationDetail: f.location_detail ?? '', pairId: f.pair_id ?? null, ref: f.photo_ref ?? '',
  };
};

// ---- app model → database payloads (only writable columns; server sets the rest) ----
export const activityToDb = (a: Activity) => ({ name: a.name, start_date: a.start, end_date: a.end, weight: a.weight });
export const reportToDb = (r: FieldReport) => ({ activity_id: r.activityId || null, report_date: r.date, actual_pct: r.actualPct, notes: r.notes, report_type: 'progress' });
export const boqToDb = (b: BoqLine) => ({ item: b.item, description: b.description, category: b.category, unit: b.unit, qty: b.qty, unit_cost: b.unitCost });
export const costToDb = (c: CostSettings) => ({ overhead_pct: c.overheadPct, contingency_pct: c.contingencyPct, insurance_pct: c.insurancePct, bond_pct: c.bondPct, warranty_pct: c.warrantyPct, markup_pct: c.markupPct, vat_pct: c.vatPct, vat_mode: c.vatMode });
export const quoteToDb = (q: Quotation) => ({ number: q.number, status: q.status, validity_days: q.validityDays, terms: q.terms, approved_at: q.approvedAt, issued_at: q.issuedAt, approved_total: q.approvedTotal, history: q.history });
export const evidenceToDb = (e: Evidence) => {
  const located = !!e.gps && (e.gpsStatus === 'captured' || e.gpsStatus === 'manual');
  const status = located ? e.gpsStatus : e.gpsStatus === 'captured' || e.gpsStatus === 'manual' ? 'unavailable' : e.gpsStatus ?? 'not_requested';
  return {
    activity_id: e.activityId || null, kind: e.kind.toLowerCase(), caption: e.caption, storage_path: e.storagePath ?? `${e.projectId}/${e.id}.jpg`, mime_type: 'image/jpeg', bytes: e.bytes,
    captured_at: e.takenAt, gps_status: status,
    gps_lat: located ? e.gps!.lat : null, gps_lng: located ? e.gps!.lng : null,
    gps_accuracy_m: located ? e.gps!.accuracy ?? null : null, gps_altitude_m: located ? e.gps!.altitude ?? null : null,
    gps_heading: located ? e.gps!.heading ?? null : null, gps_captured_at: located ? e.gps!.at : null,
    work_area: e.workArea ?? '', location_detail: e.locationDetail ?? '', pair_id: e.pairId ?? null, photo_ref: e.ref ?? '',
  };
};

export interface DbBundle {
  projects: DbProject[];
  activities: DbActivity[];
  reports: DbReport[];
  boq: DbBoq[];
  costs: DbCost[];
  quotes: DbQuote[];
  attachments: DbAttachment[];
}

/** Whole database bundle → app state (deleted rows dropped). */
export function bundleToState(b: DbBundle, base: AppState): AppState {
  const alive = <T extends { deleted_at?: string | null }>(xs: T[]) => xs.filter((x) => !x.deleted_at);
  const projects = b.projects.map(projectFromDb);
  return {
    ...base,
    projects,
    activeProjectId: projects.some((p) => p.id === base.activeProjectId) ? base.activeProjectId : projects[0]?.id ?? '',
    activities: alive(b.activities).map(activityFromDb),
    reports: alive(b.reports).map(reportFromDb),
    boq: alive(b.boq).map(boqFromDb),
    costSettings: Object.fromEntries(b.costs.map((c) => [c.project_id, costFromDb(c)])),
    quotations: Object.fromEntries(b.quotes.map((q) => [q.project_id, quoteFromDb(q)])),
    evidence: alive(b.attachments).map(evidenceFromDb),
  };
}

/** For the Google Sheet: show project CODES instead of UUIDs so the sheet stays readable. */
export function withProjectCodes(st: AppState): AppState {
  const code = new Map(st.projects.map((p) => [p.id, p.code ?? p.id]));
  const c = (id: string) => code.get(id) ?? id;
  return {
    ...st,
    projects: st.projects.map((p) => ({ ...p, id: c(p.id) })),
    activities: st.activities.map((a) => ({ ...a, projectId: c(a.projectId) })),
    reports: st.reports.map((r) => ({ ...r, projectId: c(r.projectId) })),
    boq: st.boq.map((l) => ({ ...l, projectId: c(l.projectId) })),
    costSettings: Object.fromEntries(Object.entries(st.costSettings).map(([k, v]) => [c(k), v])),
    quotations: Object.fromEntries(Object.entries(st.quotations).map(([k, v]) => [c(k), { ...v, projectId: c(k) }])),
    evidence: st.evidence.map((e) => ({ ...e, projectId: c(e.projectId) })),
  };
}
