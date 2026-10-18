import { describe, expect, it } from 'vitest';
import { actualPct, latestReport, boqTotals, plannedPct, projectProgress, quoteFigures, sCurve } from '../lib/calc';
import { approveQuote, issueQuote, newQuotation, returnToDraft, submitQuote, WorkflowError } from '../lib/quote';
import { seedState } from '../lib/seed';
import { DEFAULT_COST_SETTINGS, type BoqLine } from '../lib/types';

const s = seedState('2026-10-16T00:00:00.000Z');
const acts = (pid: string) => s.activities.filter((a) => a.projectId === pid);
const reps = (pid: string) => s.reports.filter((r) => r.projectId === pid);

describe('planned % (even daily spread, inclusive days)', () => {
  it('NEAS-Q-2026-001 is 12.5% planned on Oct 16 (1 of 8 days)', () => {
    const p = projectProgress(acts('NEAS-Q-2026-001'), reps('NEAS-Q-2026-001'), '2026-10-16');
    expect(p.planned).toBeCloseTo(12.5, 6);
    expect(p.actual).toBe(30);
    expect(p.actual - p.planned).toBeCloseTo(17.5, 6);
  });
  it('is 0 before start and 100 after finish', () => {
    const a = { start: '2026-10-16', end: '2026-10-23' };
    expect(plannedPct(a, '2026-10-15')).toBe(0);
    expect(plannedPct(a, '2026-10-23')).toBe(100);
    expect(plannedPct(a, '2026-12-01')).toBe(100);
  });
  it('NEAS-001 weighted planned on Oct 16 = 10 + 55·12/18 + 25·2/14', () => {
    const p = projectProgress(acts('NEAS-001'), reps('NEAS-001'), '2026-10-16');
    expect(p.planned).toBeCloseTo(10 + (55 * 12) / 18 + (25 * 2) / 14, 6);
    expect(p.actual).toBe(0);
  });
  it('S-curve ends at 100% planned and never decreases', () => {
    const c = sCurve(acts('NEAS-001'), []);
    expect(c[0].planned).toBe(0);
    expect(c.at(-1)!.planned).toBeCloseTo(100, 6);
    for (let i = 1; i < c.length; i++) expect(c[i].planned).toBeGreaterThanOrEqual(c[i - 1].planned);
  });
});

describe('actual %', () => {
  it('uses the latest report on or before the day', () => {
    const r = [
      { id: '1', projectId: 'P', activityId: 'A', date: '2026-10-10', actualPct: 20, notes: '', createdAt: 'a' },
      { id: '2', projectId: 'P', activityId: 'A', date: '2026-10-12', actualPct: 45, notes: '', createdAt: 'b' },
    ];
    expect(actualPct('A', r, '2026-10-09')).toBe(0);
    expect(actualPct('A', r, '2026-10-11')).toBe(20);
    expect(actualPct('A', r, '2026-10-30')).toBe(45);
  });
  it('a later save on the same date wins (edit from Project management)', () => {
    const r = [
      { id: '1', projectId: 'P', activityId: 'A', date: '2026-10-18', actualPct: 30, notes: '', createdAt: '2026-10-18T01:00:00Z' },
      { id: '2', projectId: 'P', activityId: 'A', date: '2026-10-18', actualPct: 25, notes: '', createdAt: '2026-10-18T02:00:00Z' },
    ];
    expect(latestReport('A', r)?.id).toBe('2');
    expect(actualPct('A', r, '2026-10-18')).toBe(25);
  });
});

describe('BOQ cost build-up', () => {
  const lines: BoqLine[] = [
    { id: 'l1', projectId: 'P', item: '1.01', description: 'Labour', category: 'Labor', unit: 'day', qty: 10, unitCost: 2000 },
    { id: 'l2', projectId: 'P', item: '1.02', description: 'Chemicals', category: 'Materials', unit: 'lot', qty: 1, unitCost: 5000 },
  ];
  it('matches a hand calculation with default settings', () => {
    // direct 25,000 → OH 10% 2,500 → cont 5% of 27,500 = 1,375 → cost 28,875
    // markup 15% 4,331.25 → ex-VAT 33,206.25 → VAT 12% 3,984.75 → total 37,191.00
    const t = boqTotals(lines, DEFAULT_COST_SETTINGS);
    expect(t.direct).toBe(25000);
    expect(t.overhead).toBeCloseTo(2500, 6);
    expect(t.contingency).toBeCloseTo(1375, 6);
    expect(t.costBeforeMarkup).toBeCloseTo(28875, 6);
    expect(t.markup).toBeCloseTo(4331.25, 6);
    expect(t.sellingExVat).toBeCloseTo(33206.25, 6);
    expect(t.vat).toBeCloseTo(3984.75, 6);
    expect(t.total).toBeCloseTo(37191, 6);
  });
  it('applies insurance, bond and warranty on direct + OH + contingency', () => {
    const t = boqTotals(lines, { ...DEFAULT_COST_SETTINGS, insurancePct: 1, bondPct: 2, warrantyPct: 3 });
    expect(t.insurance).toBeCloseTo(288.75, 6);
    expect(t.bond).toBeCloseTo(577.5, 6);
    expect(t.warranty).toBeCloseTo(866.25, 6);
  });
  it('VAT-exempt has no VAT', () => {
    expect(boqTotals(lines, { ...DEFAULT_COST_SETTINGS, vatMode: 'exempt' }).vat).toBe(0);
  });
  it('quotation lines add up exactly to the printed total', () => {
    const f = quoteFigures(lines, DEFAULT_COST_SETTINGS);
    const sum = f.lines.reduce((a, l) => a + l.amount, 0);
    expect(Math.round(sum * 100) / 100).toBe(f.subtotal);
    expect(f.total).toBeCloseTo(f.subtotal + f.vat, 6);
    expect(Math.abs(f.roundingDiff)).toBeLessThan(0.05);
  });
});

describe('quotation approval workflow', () => {
  const t = '2026-10-18T00:00:00Z';
  it('cannot issue without approval', () => {
    const q = newQuotation('P', t);
    expect(() => issueQuote(q, 'a', t, 100)).toThrow(WorkflowError);
    const sub = submitQuote(q, 'a', t, 100);
    expect(() => issueQuote(sub, 'a', t, 100)).toThrow(WorkflowError);
  });
  it('cannot submit a zero quote', () => {
    expect(() => submitQuote(newQuotation('P', t), 'a', t, 0)).toThrow(WorkflowError);
  });
  it('Draft → Submitted → Approved → Issued', () => {
    let q = submitQuote(newQuotation('P', t), 'est', t, 100);
    q = approveQuote(q, 'boss', t, 100);
    q = issueQuote(q, 'est', t, 100);
    expect(q.status).toBe('Issued');
    expect(q.approvedBy).toBe('boss');
    expect(() => returnToDraft(q, 'x', t, 'edit')).toThrow(WorkflowError);
  });
  it('refuses to issue if the total changed after approval', () => {
    let q = submitQuote(newQuotation('P', t), 'est', t, 100);
    q = approveQuote(q, 'boss', t, 100);
    expect(() => issueQuote(q, 'est', t, 120)).toThrow(/changed after approval/);
  });
});
