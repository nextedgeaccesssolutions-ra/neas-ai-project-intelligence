// One schema shared by Google Sheets sync, Excel export/import and the full-workbook backup.
import type { Activity, AppState, BoqCategory, BoqLine, CostSettings, Evidence, FieldReport, Project, ProjectStatus, Quotation } from './types';
import { BOQ_CATEGORIES, DEFAULT_COST_SETTINGS } from './types';
import { durationDays, latestReport, lineAmount, plannedPct, todayLocal } from './calc';

// Device-mode builds only (artifact/demo): the spreadsheet the browser itself syncs with.
// Cloud builds leave it empty; the server mirrors to the sheet and hands its link to Super Admins.
export const SHEET_ID = process.env.NEXT_PUBLIC_DEVICE_SHEET_ID ?? '';
export const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`;

export type Cell = string | number | boolean;
export interface Column {
  key: string;
  label: string;
  /** derived columns are written for reporting but ignored on import */
  derived?: boolean;
  num?: boolean;
}

export const TABS = {
  Projects: [
    { key: 'project_id', label: 'Project ID' },
    { key: 'project_name', label: 'Project name' },
    { key: 'client', label: 'Client' },
    { key: 'site', label: 'Site' },
    { key: 'status', label: 'Status' },
    { key: 'contract_value_php', label: 'Contract value (PHP)', num: true },
    { key: 'created_at', label: 'Created at' },
  ],
  Activities: [
    { key: 'activity_id', label: 'Activity ID' },
    { key: 'project_id', label: 'Project ID' },
    { key: 'activity', label: 'Activity' },
    { key: 'start', label: 'Start' },
    { key: 'end', label: 'Finish' },
    { key: 'weight_pct', label: 'Weight (%)', num: true },
    { key: 'days', label: 'Days', num: true, derived: true },
    { key: 'planned_pct_today', label: 'Planned today (%)', num: true, derived: true },
    { key: 'latest_actual_pct', label: 'Latest actual (%)', num: true, derived: true },
    { key: 'last_report_date', label: 'Last report', derived: true },
  ],
  Field_Reports: [
    { key: 'report_id', label: 'Report ID' },
    { key: 'project_id', label: 'Project ID' },
    { key: 'activity_id', label: 'Activity ID' },
    { key: 'activity', label: 'Activity', derived: true },
    { key: 'report_date', label: 'Report date' },
    { key: 'actual_pct', label: 'Actual (%)', num: true },
    { key: 'notes', label: 'Notes' },
    { key: 'saved_at', label: 'Saved at' },
  ],
  BOQ: [
    { key: 'line_id', label: 'Line ID' },
    { key: 'project_id', label: 'Project ID' },
    { key: 'item', label: 'Item' },
    { key: 'description', label: 'Description' },
    { key: 'category', label: 'Category' },
    { key: 'unit', label: 'Unit' },
    { key: 'qty', label: 'Qty', num: true },
    { key: 'unit_cost_php', label: 'Unit cost (PHP)', num: true },
    { key: 'amount_php', label: 'Amount (PHP)', num: true, derived: true },
  ],
  Cost_Settings: [
    { key: 'project_id', label: 'Project ID' },
    { key: 'overhead_pct', label: 'Overhead (%)', num: true },
    { key: 'contingency_pct', label: 'Contingency (%)', num: true },
    { key: 'insurance_pct', label: 'Insurance (%)', num: true },
    { key: 'bond_pct', label: 'Bonds (%)', num: true },
    { key: 'warranty_pct', label: 'Warranty (%)', num: true },
    { key: 'markup_pct', label: 'Markup (%)', num: true },
    { key: 'vat_pct', label: 'VAT (%)', num: true },
    { key: 'vat_mode', label: 'VAT mode' },
  ],
  Quotations: [
    { key: 'project_id', label: 'Project ID' },
    { key: 'number', label: 'Quotation no.' },
    { key: 'status', label: 'Status' },
    { key: 'validity_days', label: 'Validity (days)', num: true },
    { key: 'terms', label: 'Terms' },
    { key: 'approved_by', label: 'Approved by' },
    { key: 'approved_at', label: 'Approved at' },
    { key: 'issued_at', label: 'Issued at' },
    { key: 'approved_total_php', label: 'Approved total (PHP)', num: true },
    { key: 'history_json', label: 'History (JSON)' },
  ],
  Site_Evidence: [
    { key: 'evidence_id', label: 'Evidence ID' },
    { key: 'project_id', label: 'Project ID' },
    { key: 'activity_id', label: 'Activity ID' },
    { key: 'kind', label: 'Photo type' },
    { key: 'caption', label: 'Caption' },
    { key: 'taken_at', label: 'Taken at' },
    { key: 'bytes', label: 'Size (bytes)', num: true },
  ],
} satisfies Record<string, Column[]>;

export type TabName = keyof typeof TABS;
export const TAB_NAMES = Object.keys(TABS) as TabName[];
export type Row = Record<string, Cell>;

const s = (v: unknown): string => (v == null ? '' : String(v));
/** Number from a cell, tolerating "₱1,234.50", "PHP 1,234", "45.0%", "−3" and "—". */
const n = (v: unknown): number | '' => {
  if (v === '' || v == null) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? v : '';
  const t = String(v).replace(/php|[₱,%\s]/gi, '').replace(/[−–]/g, '-');
  if (t === '' || t === '—' || t === '-') return '';
  const x = Number(t);
  return Number.isFinite(x) ? x : '';
};

/** App state → rows per tab (objects keyed by column key). */
export function stateToRows(st: AppState, today = todayLocal()): Record<TabName, Row[]> {
  const actName = (id: string) => st.activities.find((a) => a.id === id)?.name ?? '';
  return {
    Projects: st.projects.map((p) => ({ project_id: p.id, project_name: p.name, client: p.client, site: p.site, status: p.status, contract_value_php: p.contractValue ?? '', created_at: p.createdAt })),
    Activities: st.activities.map((a) => {
      const reps = st.reports.filter((r) => r.projectId === a.projectId);
      const last = latestReport(a.id, reps);
      return {
        activity_id: a.id, project_id: a.projectId, activity: a.name, start: a.start, end: a.end, weight_pct: a.weight,
        days: durationDays(a), planned_pct_today: Math.round(plannedPct(a, today) * 10) / 10,
        latest_actual_pct: last?.actualPct ?? 0, last_report_date: last?.date ?? '',
      };
    }),
    Field_Reports: st.reports.map((r) => ({ report_id: r.id, project_id: r.projectId, activity_id: r.activityId, activity: actName(r.activityId), report_date: r.date, actual_pct: r.actualPct, notes: r.notes, saved_at: r.createdAt })),
    BOQ: st.boq.map((l) => ({ line_id: l.id, project_id: l.projectId, item: l.item, description: l.description, category: l.category, unit: l.unit, qty: l.qty, unit_cost_php: l.unitCost, amount_php: lineAmount(l) })),
    Cost_Settings: Object.entries(st.costSettings).map(([pid, c]) => ({ project_id: pid, overhead_pct: c.overheadPct, contingency_pct: c.contingencyPct, insurance_pct: c.insurancePct, bond_pct: c.bondPct, warranty_pct: c.warrantyPct, markup_pct: c.markupPct, vat_pct: c.vatPct, vat_mode: c.vatMode })),
    Quotations: Object.values(st.quotations).map((q) => ({ project_id: q.projectId, number: q.number, status: q.status, validity_days: q.validityDays, terms: q.terms, approved_by: q.approvedBy ?? '', approved_at: q.approvedAt ?? '', issued_at: q.issuedAt ?? '', approved_total_php: q.approvedTotal ?? '', history_json: JSON.stringify(q.history) })),
    Site_Evidence: st.evidence.map((e) => ({ evidence_id: e.id, project_id: e.projectId, activity_id: e.activityId, kind: e.kind, caption: e.caption, taken_at: e.takenAt, bytes: e.bytes })),
  };
}

/** Rows → 2D grid with a header row of column labels (import accepts labels or keys). */
export function rowsToGrid(tab: TabName, rows: Row[]): Cell[][] {
  const cols = TABS[tab] as Column[];
  return [cols.map((c) => c.label), ...rows.map((r) => cols.map((c) => r[c.key] ?? ''))];
}

/** Map a header cell (key or label, any case) to a column key. */
export function matchColumn(cols: Column[], header: unknown): string | null {
  const h = s(header).trim().toLowerCase();
  if (!h) return null;
  const hit = cols.find((c) => c.key.toLowerCase() === h || c.label.toLowerCase() === h || c.label.toLowerCase().replace(/\s*\(.*\)$/, '') === h);
  return hit ? hit.key : null;
}

/** 2D grid (first row headers) → rows keyed by column key; unknown columns dropped. */
export function gridToRows(cols: Column[], grid: unknown[][]): Row[] {
  if (!grid.length) return [];
  const keys = grid[0].map((h) => matchColumn(cols, h));
  return grid
    .slice(1)
    .filter((line) => line.some((v) => s(v).trim() !== ''))
    .map((line) => {
      const r: Row = {};
      keys.forEach((k, i) => {
        if (k) r[k] = (line[i] ?? '') as Cell;
      });
      return r;
    });
}

const STATUSES: ProjectStatus[] = ['draft', 'active', 'on-hold', 'completed'];
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Normalise a date cell: ISO, Excel serial, or Date → YYYY-MM-DD ('' if unreadable). */
export function toDateStr(v: unknown): string {
  if (v instanceof Date && !isNaN(+v)) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10);
  const t = s(v).trim();
  if (isDate(t.slice(0, 10))) return t.slice(0, 10);
  const d = new Date(t);
  return t && !isNaN(+d) ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '';
}

export interface ParsedRow<T> { value?: T; error?: string; line: number }

export function parseProject(r: Row, line: number): ParsedRow<Project> {
  const id = s(r.project_id).trim().toUpperCase();
  if (!id) return { line, error: 'Project ID is missing' };
  if (!s(r.project_name).trim()) return { line, error: `${id}: project name is missing` };
  const status = (STATUSES as string[]).includes(s(r.status).toLowerCase()) ? (s(r.status).toLowerCase() as ProjectStatus) : 'active';
  const cv = n(r.contract_value_php);
  return { line, value: { id, name: s(r.project_name).trim(), client: s(r.client), site: s(r.site), status, contractValue: cv === '' ? null : cv, createdAt: s(r.created_at) || new Date().toISOString() } };
}

export function parseActivity(r: Row, line: number, defaultProject: string, idFor: () => string): ParsedRow<Activity> {
  const name = s(r.activity).trim();
  const start = toDateStr(r.start);
  const end = toDateStr(r.end);
  const w = n(r.weight_pct);
  if (!name) return { line, error: 'Activity name is missing' };
  if (!start || !end) return { line, error: `${name}: start/finish must be dates` };
  if (end < start) return { line, error: `${name}: finish is before start` };
  if (w === '' || w <= 0 || w > 100) return { line, error: `${name}: weight must be 0–100` };
  return { line, value: { id: s(r.activity_id).trim() || idFor(), projectId: s(r.project_id).trim().toUpperCase() || defaultProject, name, start, end, weight: w } };
}

export function parseReport(r: Row, line: number, defaultProject: string, activityIdByName: (name: string) => string | undefined, idFor: () => string): ParsedRow<FieldReport> {
  const activityId = s(r.activity_id).trim() || activityIdByName(s(r.activity).trim()) || '';
  const date = toDateStr(r.report_date);
  const pct = n(r.actual_pct);
  if (!activityId) return { line, error: `Unknown activity “${s(r.activity)}”` };
  if (!date) return { line, error: 'Report date is missing' };
  if (pct === '' || pct < 0 || pct > 100) return { line, error: 'Actual % must be 0–100' };
  return { line, value: { id: s(r.report_id).trim() || idFor(), projectId: s(r.project_id).trim().toUpperCase() || defaultProject, activityId, date, actualPct: pct, notes: s(r.notes), createdAt: s(r.saved_at) || new Date().toISOString() } };
}

export function parseBoq(r: Row, line: number, defaultProject: string, idFor: () => string): ParsedRow<BoqLine> {
  const desc = s(r.description).trim();
  const qty = n(r.qty);
  const cost = n(r.unit_cost_php);
  if (!desc) return { line, error: 'Description is missing' };
  if (qty === '' || qty <= 0) return { line, error: `${desc}: quantity must be more than 0` };
  if (cost === '' || cost < 0) return { line, error: `${desc}: unit cost must be 0 or more` };
  const cat = BOQ_CATEGORIES.find((c) => c.toLowerCase() === s(r.category).trim().toLowerCase()) ?? ('Other' as BoqCategory);
  return { line, value: { id: s(r.line_id).trim() || idFor(), projectId: s(r.project_id).trim().toUpperCase() || defaultProject, item: s(r.item).trim(), description: desc, category: cat, unit: s(r.unit).trim() || 'lot', qty, unitCost: cost } };
}

/** Whole workbook (Sheets tabs or Excel) → app state. Throws if Projects tab is empty. */
export function rowsToState(tabs: Partial<Record<TabName, Row[]>>, base: AppState): AppState {
  let k = 0;
  const id = (p: string) => () => `${p}_imp${Date.now().toString(36)}${(k++).toString(36)}`;
  const projects = (tabs.Projects ?? []).map((r, i) => parseProject(r, i + 2).value).filter(Boolean) as Project[];
  if (!projects.length) throw new Error('The Projects tab has no valid rows.');
  const firstPid = projects[0].id;
  const activities = (tabs.Activities ?? []).map((r, i) => parseActivity(r, i + 2, firstPid, id('act')).value).filter(Boolean) as Activity[];
  const reports = (tabs.Field_Reports ?? [])
    .map((r, i) => parseReport(r, i + 2, firstPid, (nm) => activities.find((a) => a.name === nm)?.id, id('rep')).value)
    .filter(Boolean) as FieldReport[];
  const boq = (tabs.BOQ ?? []).map((r, i) => parseBoq(r, i + 2, firstPid, id('boq')).value).filter(Boolean) as BoqLine[];
  const costSettings: Record<string, CostSettings> = {};
  for (const r of tabs.Cost_Settings ?? []) {
    const pid = s(r.project_id).trim().toUpperCase();
    if (!pid) continue;
    const num = (v: unknown, d: number) => (n(v) === '' ? d : (n(v) as number));
    const D = DEFAULT_COST_SETTINGS;
    costSettings[pid] = {
      overheadPct: num(r.overhead_pct, D.overheadPct), contingencyPct: num(r.contingency_pct, D.contingencyPct), insurancePct: num(r.insurance_pct, D.insurancePct),
      bondPct: num(r.bond_pct, D.bondPct), warrantyPct: num(r.warranty_pct, D.warrantyPct), markupPct: num(r.markup_pct, D.markupPct), vatPct: num(r.vat_pct, D.vatPct),
      vatMode: s(r.vat_mode) === 'exempt' ? 'exempt' : 'exclusive',
    };
  }
  const quotations: Record<string, Quotation> = {};
  for (const r of tabs.Quotations ?? []) {
    const pid = s(r.project_id).trim().toUpperCase();
    if (!pid) continue;
    let history: Quotation['history'] = [];
    try { history = JSON.parse(s(r.history_json) || '[]'); } catch { history = []; }
    const st = s(r.status) as Quotation['status'];
    const tot = n(r.approved_total_php);
    quotations[pid] = {
      projectId: pid, number: s(r.number) || `Q-${pid}`, status: ['Draft', 'Submitted', 'Approved', 'Issued'].includes(st) ? st : 'Draft',
      validityDays: (n(r.validity_days) || 30) as number, terms: s(r.terms), approvedBy: s(r.approved_by) || null, approvedAt: s(r.approved_at) || null,
      issuedAt: s(r.issued_at) || null, approvedTotal: tot === '' ? null : tot, history,
    };
  }
  const evidence = (tabs.Site_Evidence ?? [])
    .filter((r) => s(r.evidence_id))
    .map((r) => ({ id: s(r.evidence_id), projectId: s(r.project_id).toUpperCase(), activityId: s(r.activity_id), kind: (['Before', 'During', 'After', 'Inspection', 'Safety', 'Defect'].includes(s(r.kind)) ? s(r.kind) : 'During') as Evidence['kind'], caption: s(r.caption), takenAt: s(r.taken_at), bytes: Number(r.bytes) || 0 }));
  return {
    ...base,
    activeProjectId: projects.some((p) => p.id === base.activeProjectId) ? base.activeProjectId : firstPid,
    projects, activities, reports, boq, costSettings, quotations, evidence,
  };
}

const OWN_LINK = /^=HYPERLINK\("https:\/\/www\.google\.com\/maps\?q=-?\d{1,2}\.\d{6},-?\d{1,3}\.\d{6}","VIEW LOCATION ON MAP"\)$/;
/** Text that starts like a formula is stored with a leading apostrophe (shown as plain text). */
export function safeCell(c: Cell): Cell {
  return typeof c === 'string' && /^[=+\-@]/.test(c) && !OWN_LINK.test(c) ? `'${c}` : c;
}
