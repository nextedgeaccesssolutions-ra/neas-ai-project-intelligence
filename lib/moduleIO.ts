// Per-module export documents and import plans. Pure functions over app state.
import type { AppState } from './types';
import { boqTotals, latestReport, plannedPct, projectProgress, quoteFigures, todayLocal, durationDays, lineAmount } from './calc';
import { DEFAULT_COST_SETTINGS } from './types';
import { fmtDate, fmtPHP, fmtPct } from './format';
import { parseActivity, parseBoq, parseProject, parseReport, TABS, type Column, type Row } from './sheetSchema';
import type { ExportDoc, TableColumn } from './fileio';
import { newQuotation } from './quote';

const php = (v: unknown) => (v === '' || v == null ? '—' : fmtPHP(Number(v)));
const pct = (v: unknown) => (v === '' || v == null ? '—' : fmtPct(Number(v)));
const date = (v: unknown) => (v ? fmtDate(String(v).slice(0, 10)) : '—');
const stamp = () => todayLocal();
const uidGen = (p: string) => {
  let k = 0;
  return () => `${p}_${Date.now().toString(36)}${(k++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
};
const projectLine = (st: AppState, pid: string): [string, string] => {
  const p = st.projects.find((x) => x.id === pid);
  return ['Project', p ? `${p.id} · ${p.name}` : pid];
};

// ---------- column sets (import keys match the Google Sheet tabs) ----------
export const COLS = {
  projects: TABS.Projects as Column[],
  activities: TABS.Activities as Column[],
  reports: TABS.Field_Reports as Column[],
  boq: TABS.BOQ as Column[],
};

// ---------- exports ----------
export function overviewDoc(st: AppState, asOf: string): ExportDoc {
  const pid = st.activeProjectId;
  const p = st.projects.find((x) => x.id === pid);
  const acts = st.activities.filter((a) => a.projectId === pid).sort((a, b) => a.start.localeCompare(b.start));
  const reps = st.reports.filter((r) => r.projectId === pid);
  const prog = projectProgress(acts, reps, asOf);
  const cols: TableColumn[] = [
    { key: 'activity', label: 'Activity' },
    { key: 'start', label: 'Start', fmt: date },
    { key: 'end', label: 'Finish', fmt: date },
    { key: 'weight_pct', label: 'Weight (%)', num: true, fmt: pct },
    { key: 'planned_pct', label: 'Planned (%)', num: true, fmt: pct },
    { key: 'actual_pct', label: 'Actual (%)', num: true, fmt: pct },
    { key: 'variance_pp', label: 'Variance (pp)', num: true, fmt: (v) => `${Number(v) > 0 ? '+' : ''}${Number(v).toFixed(1)}` },
  ];
  const rows = acts.map((a) => {
    const plan = Math.round(plannedPct(a, asOf) * 10) / 10;
    const act = latestReport(a.id, reps, asOf)?.actualPct ?? 0;
    return { activity: a.name, start: a.start, end: a.end, weight_pct: a.weight, planned_pct: plan, actual_pct: act, variance_pp: Math.round((act - plan) * 10) / 10 };
  });
  return {
    filename: `${pid}-overview-${asOf}`,
    title: 'Project overview',
    subtitle: `Status as of ${fmtDate(asOf)}`,
    meta: [
      projectLine(st, pid),
      ['Contract value', fmtPHP(p?.contractValue ?? null)],
      ['Planned progress', fmtPct(prog.planned)],
      ['Actual progress', fmtPct(prog.actual)],
      ['Schedule variance', `${(prog.actual - prog.planned).toFixed(1)} pp`],
    ],
    tables: [{ title: 'Activity progress', columns: cols, rows }],
  };
}

export function activitiesDoc(st: AppState): ExportDoc {
  const pid = st.activeProjectId;
  const today = todayLocal();
  const reps = st.reports.filter((r) => r.projectId === pid);
  const rows = st.activities
    .filter((a) => a.projectId === pid)
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((a) => {
      const lr = latestReport(a.id, reps);
      return { activity_id: a.id, project_id: a.projectId, activity: a.name, start: a.start, end: a.end, weight_pct: a.weight, days: durationDays(a), planned_pct_today: Math.round(plannedPct(a, today) * 10) / 10, latest_actual_pct: lr?.actualPct ?? 0, last_report_date: lr?.date ?? '' };
    });
  const fm: Record<string, TableColumn['fmt']> = { start: date, end: date, weight_pct: pct, planned_pct_today: pct, latest_actual_pct: pct, last_report_date: date };
  return {
    filename: `${pid}-activities-${stamp()}`,
    title: 'Project activities',
    meta: [projectLine(st, pid), ['Exported', fmtDate(today)]],
    tables: [{ title: 'Activities', columns: COLS.activities.map((c) => ({ ...c, fmt: fm[c.key] })), rows }],
  };
}

export function reportsDoc(st: AppState, activityFilter = ''): ExportDoc {
  const pid = st.activeProjectId;
  const name = (id: string) => st.activities.find((a) => a.id === id)?.name ?? '';
  const rows = st.reports
    .filter((r) => r.projectId === pid && (!activityFilter || r.activityId === activityFilter))
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((r) => ({ report_id: r.id, project_id: r.projectId, activity_id: r.activityId, activity: name(r.activityId), report_date: r.date, actual_pct: r.actualPct, notes: r.notes, saved_at: r.createdAt }));
  const fm: Record<string, TableColumn['fmt']> = { report_date: date, actual_pct: pct, saved_at: (v) => (v ? new Date(String(v)).toLocaleString() : '') };
  return {
    filename: `${pid}-field-reports-${stamp()}`,
    title: 'Field reports',
    meta: [projectLine(st, pid), ['Reports', String(rows.length)]],
    tables: [{ title: 'Field reports', columns: COLS.reports.map((c) => ({ ...c, fmt: fm[c.key] })), rows }],
  };
}

export function projectsDoc(st: AppState): ExportDoc {
  const today = todayLocal();
  const rows = st.projects.map((p) => {
    const acts = st.activities.filter((a) => a.projectId === p.id);
    const prog = projectProgress(acts, st.reports.filter((r) => r.projectId === p.id), today);
    const t = boqTotals(st.boq.filter((b) => b.projectId === p.id), st.costSettings[p.id] ?? DEFAULT_COST_SETTINGS);
    return { project_id: p.id, project_name: p.name, client: p.client, site: p.site, status: p.status, contract_value_php: p.contractValue ?? '', created_at: p.createdAt, boq_total_php: t.direct > 0 ? Math.round(t.total * 100) / 100 : '', planned_pct: acts.length ? Math.round(prog.planned * 10) / 10 : '', actual_pct: acts.length ? Math.round(prog.actual * 10) / 10 : '' };
  });
  const cols: TableColumn[] = [
    ...COLS.projects.map((c) => ({ ...c, fmt: c.key === 'contract_value_php' ? php : c.key === 'created_at' ? date : undefined })),
    { key: 'boq_total_php', label: 'BOQ total (PHP)', num: true, derived: true, fmt: php },
    { key: 'planned_pct', label: 'Planned today (%)', num: true, derived: true, fmt: pct },
    { key: 'actual_pct', label: 'Actual today (%)', num: true, derived: true, fmt: pct },
  ];
  return { filename: `neas-project-register-${stamp()}`, title: 'Project register', meta: [['Projects', String(rows.length)], ['As of', fmtDate(today)]], tables: [{ title: 'Projects', columns: cols, rows }] };
}

export function boqDoc(st: AppState): ExportDoc {
  const pid = st.activeProjectId;
  const lines = st.boq.filter((b) => b.projectId === pid).sort((a, b) => a.item.localeCompare(b.item, undefined, { numeric: true }));
  const cs = st.costSettings[pid] ?? DEFAULT_COST_SETTINGS;
  const t = boqTotals(lines, cs);
  const rows = lines.map((l) => ({ line_id: l.id, project_id: l.projectId, item: l.item, description: l.description, category: l.category, unit: l.unit, qty: l.qty, unit_cost_php: l.unitCost, amount_php: lineAmount(l) }));
  const fm: Record<string, TableColumn['fmt']> = { unit_cost_php: php, amount_php: php };
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const buildup = [
    ['Direct cost', t.direct], [`Overhead ${cs.overheadPct}%`, t.overhead], [`Contingency ${cs.contingencyPct}%`, t.contingency],
    [`Insurance ${cs.insurancePct}%`, t.insurance], [`Bonds ${cs.bondPct}%`, t.bond], [`Warranty reserve ${cs.warrantyPct}%`, t.warranty],
    [`Markup ${cs.markupPct}%`, t.markup], ['Selling price ex-VAT', t.sellingExVat], [cs.vatMode === 'exclusive' ? `VAT ${cs.vatPct}%` : 'VAT (exempt)', t.vat], ['Quotation total', t.total],
  ].map(([k, v]) => ({ component: k as string, amount_php: r2(v as number) }));
  return {
    filename: `${pid}-boq-${stamp()}`,
    title: 'Bill of quantities (internal)',
    meta: [projectLine(st, pid), ['Lines', String(lines.length)], ['Confidential', 'Internal cost data — not for clients']],
    tables: [
      { title: 'BOQ', columns: [...COLS.boq.filter((c) => c.key !== 'project_id' && c.key !== 'line_id').map((c): TableColumn => ({ ...c, fmt: fm[c.key] })), { key: 'line_id', label: 'Line ID' }], rows },
      { title: 'Price build-up', columns: [{ key: 'component', label: 'Component' }, { key: 'amount_php', label: 'Amount (PHP)', num: true, fmt: php }], rows: buildup },
    ],
  };
}

export function quotationDoc(st: AppState): ExportDoc {
  const pid = st.activeProjectId;
  const p = st.projects.find((x) => x.id === pid);
  const cs = st.costSettings[pid] ?? DEFAULT_COST_SETTINGS;
  const q = st.quotations[pid] ?? newQuotation(pid, new Date().toISOString());
  const f = quoteFigures(st.boq.filter((b) => b.projectId === pid).sort((a, b) => a.item.localeCompare(b.item, undefined, { numeric: true })), cs);
  const official = q?.status === 'Approved' || q?.status === 'Issued';
  const rows: Row[] = f.lines.map((l) => ({ item: l.item, description: l.description, unit: l.unit, qty: l.qty, unit_price_php: l.unitPrice, amount_php: l.amount }));
  rows.push({ item: '', description: 'Subtotal (VAT-exclusive)', unit: '', qty: '', unit_price_php: '', amount_php: f.subtotal });
  rows.push({ item: '', description: cs.vatMode === 'exclusive' ? `VAT ${cs.vatPct}%` : 'VAT (exempt / zero-rated)', unit: '', qty: '', unit_price_php: '', amount_php: f.vat });
  rows.push({ item: '', description: 'TOTAL AMOUNT', unit: '', qty: '', unit_price_php: '', amount_php: f.total });
  return {
    filename: `${q?.number ?? 'Q-' + pid}${official ? '' : '-DRAFT'}`,
    title: `Quotation ${q?.number ?? 'Q-' + pid}${official ? '' : ' (DRAFT - NOT FOR ISSUE)'}`,
    meta: [
      ['Project', `${p?.name ?? pid} (${pid})`],
      ['Client', p?.client || '—'],
      ['Site', p?.site || '—'],
      ['Status', q?.status ?? 'Draft'],
      ['Approved by', q?.approvedBy ?? 'Not yet approved'],
      ['Validity', `${q?.validityDays ?? 30} days`],
      ['Terms', q?.terms ?? ''],
    ],
    tables: [{
      title: 'Quotation',
      columns: [
        { key: 'item', label: 'Item' }, { key: 'description', label: 'Description' }, { key: 'unit', label: 'Unit' },
        { key: 'qty', label: 'Qty', num: true }, { key: 'unit_price_php', label: 'Unit price (PHP)', num: true, fmt: php }, { key: 'amount_php', label: 'Amount (PHP)', num: true, fmt: php },
      ],
      rows,
    }],
    footer: 'NextEdge Access Solutions',
  };
}

export function evidenceDoc(st: AppState, images: { caption: string; blob: Blob }[] = []): ExportDoc {
  const pid = st.activeProjectId;
  const name = (id: string) => st.activities.find((a) => a.id === id)?.name ?? '';
  const rows = st.evidence.filter((e) => e.projectId === pid).map((e) => ({ kind: e.kind, activity: name(e.activityId), caption: e.caption, taken_at: e.takenAt, size_kb: Math.round(e.bytes / 1024), evidence_id: e.id }));
  return {
    filename: `${pid}-site-evidence-${stamp()}`,
    title: 'Site evidence report',
    meta: [projectLine(st, pid), ['Photos', String(rows.length)]],
    tables: [{
      title: 'Photos',
      columns: [{ key: 'kind', label: 'Type' }, { key: 'activity', label: 'Activity' }, { key: 'caption', label: 'Caption' }, { key: 'taken_at', label: 'Taken at', fmt: (v) => (v ? new Date(String(v)).toLocaleString() : '') }, { key: 'size_kb', label: 'Size (KB)', num: true }, { key: 'evidence_id', label: 'Evidence ID' }],
      rows,
    }],
    images,
  };
}

// ---------- import plans ----------
export interface Plan {
  next: AppState;
  added: number;
  updated: number;
  errors: string[];
}

export function planProjects(st: AppState, rows: Row[]): Plan {
  const projects = [...st.projects];
  let added = 0, updated = 0;
  const errors: string[] = [];
  rows.forEach((r, i) => {
    const res = parseProject(r, i + 2);
    if (!res.value) return errors.push(`row ${res.line}: ${res.error}`);
    const at = projects.findIndex((p) => p.id === res.value!.id);
    if (at >= 0) { projects[at] = { ...res.value, createdAt: projects[at].createdAt }; updated++; } else { projects.push(res.value); added++; }
  });
  return { next: { ...st, projects }, added, updated, errors };
}

export function planActivities(st: AppState, rows: Row[]): Plan {
  const pid = st.activeProjectId;
  const activities = [...st.activities];
  const id = uidGen('act');
  let added = 0, updated = 0;
  const errors: string[] = [];
  rows.forEach((r, i) => {
    const res = parseActivity(r, i + 2, pid, id);
    if (!res.value) return errors.push(`row ${res.line}: ${res.error}`);
    const a = res.value;
    if (!st.projects.some((p) => p.id === a.projectId)) return errors.push(`row ${res.line}: project ${a.projectId} does not exist`);
    const at = activities.findIndex((x) => x.id === a.id || (x.projectId === a.projectId && x.name.toLowerCase() === a.name.toLowerCase()));
    if (at >= 0) { activities[at] = { ...a, id: activities[at].id }; updated++; } else { activities.push(a); added++; }
  });
  return { next: { ...st, activities }, added, updated, errors };
}

export function planReports(st: AppState, rows: Row[]): Plan {
  const pid = st.activeProjectId;
  const reports = [...st.reports];
  const id = uidGen('rep');
  const byName = (n: string) => st.activities.find((a) => a.projectId === pid && a.name.toLowerCase() === n.toLowerCase())?.id;
  let added = 0, updated = 0;
  const errors: string[] = [];
  rows.forEach((r, i) => {
    const res = parseReport(r, i + 2, pid, byName, id);
    if (!res.value) return errors.push(`row ${res.line}: ${res.error}`);
    const rep = res.value;
    const act = st.activities.find((a) => a.id === rep.activityId);
    if (!act) return errors.push(`row ${res.line}: activity not found`);
    rep.projectId = act.projectId;
    const at = reports.findIndex((x) => x.id === rep.id);
    const dup = reports.some((x) => x.activityId === rep.activityId && x.date === rep.date && x.actualPct === rep.actualPct && x.notes === rep.notes);
    if (at >= 0) { reports[at] = rep; updated++; } else if (!dup) { reports.push(rep); added++; }
  });
  return { next: { ...st, reports }, added, updated, errors };
}

export function planBoq(st: AppState, rows: Row[]): Plan {
  const pid = st.activeProjectId;
  if (st.quotations[pid]?.status === 'Issued') return { next: st, added: 0, updated: 0, errors: ['The quotation was issued, so the BOQ is locked'] };
  const boq = [...st.boq];
  const id = uidGen('boq');
  let added = 0, updated = 0;
  const errors: string[] = [];
  rows.forEach((r, i) => {
    const res = parseBoq(r, i + 2, pid, id);
    if (!res.value) return errors.push(`row ${res.line}: ${res.error}`);
    const l = { ...res.value, projectId: pid };
    if (!l.item) l.item = `1.${String(boq.filter((b) => b.projectId === pid).length + 1).padStart(2, '0')}`;
    const at = boq.findIndex((x) => x.id === l.id || (x.projectId === pid && x.item === l.item && x.description === l.description));
    if (at >= 0) { boq[at] = { ...l, id: boq[at].id }; updated++; } else { boq.push(l); added++; }
  });
  let next = { ...st, boq };
  const q = st.quotations[pid];
  if ((added || updated) && q && (q.status === 'Submitted' || q.status === 'Approved')) {
    next = { ...next, quotations: { ...st.quotations, [pid]: { ...q, status: 'Draft', approvedBy: null, approvedAt: null, approvedTotal: null, history: [...q.history, { at: new Date().toISOString(), action: 'Returned to Draft: BOQ imported', by: st.userName || 'user' }] } } };
  }
  return { next, added, updated, errors };
}
