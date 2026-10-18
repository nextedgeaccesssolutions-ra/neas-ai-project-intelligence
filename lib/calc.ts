// Deterministic project-control calculations. No AI, no rounding until display.
import type { Activity, BoqLine, CostSettings, FieldReport } from './types';

const DAY = 86_400_000;

export const toMs = (d: string): number => Date.parse(d.slice(0, 10) + 'T00:00:00Z');
export const toIso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
export const addDays = (d: string, n: number): string => toIso(toMs(d) + n * DAY);
export const daysBetween = (a: string, b: string): number => Math.round((toMs(b) - toMs(a)) / DAY);

export function todayLocal(now = new Date()): string {
  const p = (x: number) => String(x).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** Calendar days in an activity, start and end inclusive (min 1). */
export const durationDays = (a: Pick<Activity, 'start' | 'end'>): number => Math.max(1, daysBetween(a.start, a.end) + 1);

/**
 * Planned % complete of one activity at the END of `day`.
 * Work is spread evenly over the activity's calendar days, start and end inclusive.
 */
export function plannedPct(a: Pick<Activity, 'start' | 'end'>, day: string): number {
  const dur = durationDays(a);
  const elapsed = Math.min(Math.max(daysBetween(a.start, day) + 1, 0), dur);
  return (elapsed / dur) * 100;
}

/** Latest field report for an activity on or before `day` (latest date, then latest saved). */
export function latestReport(activityId: string, reports: FieldReport[], day = '9999-12-31'): FieldReport | null {
  let best: FieldReport | null = null;
  for (const r of reports) {
    if (r.activityId !== activityId || r.date > day) continue;
    if (!best || r.date > best.date || (r.date === best.date && r.createdAt > best.createdAt)) best = r;
  }
  return best;
}

/** Latest reported cumulative % for an activity on or before `day` (0 if none). */
export function actualPct(activityId: string, reports: FieldReport[], day: string): number {
  const best = latestReport(activityId, reports, day);
  return best ? clampPct(best.actualPct) : 0;
}

export const clampPct = (x: number) => Math.min(100, Math.max(0, Number.isFinite(x) ? x : 0));

export function totalWeight(acts: Activity[]): number {
  return acts.reduce((s, a) => s + (Number(a.weight) || 0), 0);
}

export interface ProgressPoint {
  day: string;
  planned: number;
  actual: number;
}

/** Weighted project progress on `day`. Weights are normalised by their total. */
export function projectProgress(acts: Activity[], reports: FieldReport[], day: string): ProgressPoint {
  const w = totalWeight(acts);
  if (!acts.length || w <= 0) return { day, planned: 0, actual: 0 };
  let p = 0;
  let a = 0;
  for (const act of acts) {
    p += act.weight * plannedPct(act, day);
    a += act.weight * actualPct(act.id, reports, day);
  }
  return { day, planned: p / w, actual: a / w };
}

export function projectSpan(acts: Activity[]): { start: string; end: string } | null {
  if (!acts.length) return null;
  let start = acts[0].start;
  let end = acts[0].end;
  for (const a of acts) {
    if (a.start < start) start = a.start;
    if (a.end > end) end = a.end;
  }
  return { start, end };
}

/** Daily S-curve from the day before the first start to the last finish. */
export function sCurve(acts: Activity[], reports: FieldReport[]): ProgressPoint[] {
  const span = projectSpan(acts);
  if (!span) return [];
  const out: ProgressPoint[] = [];
  for (let d = addDays(span.start, -1); d <= span.end; d = addDays(d, 1)) out.push(projectProgress(acts, reports, d));
  return out;
}

// ---------- Estimating ----------

export interface BoqTotals {
  byCategory: Record<string, number>;
  direct: number;
  overhead: number;
  contingency: number;
  insurance: number;
  bond: number;
  warranty: number;
  costBeforeMarkup: number;
  markup: number;
  sellingExVat: number;
  vat: number;
  total: number;
  /** selling price ÷ direct cost, used to price each quotation line */
  sellFactor: number;
}

export const lineAmount = (l: Pick<BoqLine, 'qty' | 'unitCost'>) => (Number(l.qty) || 0) * (Number(l.unitCost) || 0);

/**
 * Cost build-up (each % is a separate, configurable component):
 *   direct → +overhead (on direct) → +contingency (on direct+overhead)
 *   → +insurance, bond, warranty reserve (on direct+overhead+contingency)
 *   → +markup (on that cost) = selling price ex-VAT → +VAT (if exclusive).
 */
export function boqTotals(lines: BoqLine[], s: CostSettings): BoqTotals {
  const byCategory: Record<string, number> = {};
  let direct = 0;
  for (const l of lines) {
    const amt = lineAmount(l);
    byCategory[l.category] = (byCategory[l.category] || 0) + amt;
    direct += amt;
  }
  const overhead = direct * (s.overheadPct / 100);
  const contingency = (direct + overhead) * (s.contingencyPct / 100);
  const base = direct + overhead + contingency;
  const insurance = base * (s.insurancePct / 100);
  const bond = base * (s.bondPct / 100);
  const warranty = base * (s.warrantyPct / 100);
  const costBeforeMarkup = base + insurance + bond + warranty;
  const markup = costBeforeMarkup * (s.markupPct / 100);
  const sellingExVat = costBeforeMarkup + markup;
  const vat = s.vatMode === 'exclusive' ? sellingExVat * (s.vatPct / 100) : 0;
  return {
    byCategory,
    direct,
    overhead,
    contingency,
    insurance,
    bond,
    warranty,
    costBeforeMarkup,
    markup,
    sellingExVat,
    vat,
    total: sellingExVat + vat,
    sellFactor: direct > 0 ? sellingExVat / direct : 0,
  };
}

export const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

export interface QuoteLine {
  id: string;
  item: string;
  description: string;
  unit: string;
  qty: number;
  unitPrice: number;
  amount: number;
}

/**
 * Client-facing figures: each line's unit price carries its share of all markups
 * (direct × sellFactor), rounded to the centavo. The quote total is built from the
 * rounded lines, so the printed lines always add up to the printed total.
 */
export function quoteFigures(lines: BoqLine[], s: CostSettings) {
  const t = boqTotals(lines, s);
  const qLines: QuoteLine[] = lines.map((l) => {
    const unitPrice = round2((Number(l.unitCost) || 0) * t.sellFactor);
    return { id: l.id, item: l.item, description: l.description, unit: l.unit, qty: Number(l.qty) || 0, unitPrice, amount: round2(unitPrice * (Number(l.qty) || 0)) };
  });
  const subtotal = round2(qLines.reduce((a, l) => a + l.amount, 0));
  const vat = s.vatMode === 'exclusive' ? round2(subtotal * (s.vatPct / 100)) : 0;
  return { lines: qLines, subtotal, vat, total: round2(subtotal + vat), roundingDiff: round2(subtotal - t.sellingExVat) };
}
