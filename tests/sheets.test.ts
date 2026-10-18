import { describe, expect, it } from 'vitest';
import { seedState } from '../lib/seed';
import { gridToRows, rowsToGrid, rowsToState, stateToRows, TAB_NAMES, TABS, toDateStr, type Column, type Row, type TabName } from '../lib/sheetSchema';
import { planActivities, planBoq, planReports } from '../lib/moduleIO';

const base = () => {
  const s = seedState('2026-10-16T00:00:00.000Z');
  s.boq = [{ id: 'b1', projectId: 'NEAS-Q-2026-001', item: '1.01', description: 'Rope access team', category: 'Labor', unit: 'day', qty: 4, unitCost: 9000 }];
  s.costSettings = { 'NEAS-Q-2026-001': { overheadPct: 10, contingencyPct: 5, insurancePct: 1, bondPct: 0, warrantyPct: 2, markupPct: 15, vatPct: 12, vatMode: 'exclusive' } };
  return s;
};

describe('Google Sheet mirror round trip', () => {
  it('state → sheet grids → state keeps every record', () => {
    const s = base();
    const rows = stateToRows(s, '2026-10-18');
    const tabs: Partial<Record<TabName, Row[]>> = {};
    for (const t of TAB_NAMES) {
      const grid = rowsToGrid(t, rows[t]);
      // the Sheets API returns everything as display strings
      const asStrings = grid.map((r) => r.map((c) => String(c)));
      tabs[t] = gridToRows(TABS[t] as Column[], asStrings);
    }
    const back = rowsToState(tabs, s);
    expect(back.projects).toEqual(s.projects);
    expect(back.activities).toEqual(s.activities);
    expect(back.reports).toEqual(s.reports);
    expect(back.boq).toEqual(s.boq);
    expect(back.costSettings).toEqual(s.costSettings);
  });
  it('header row uses readable labels and import accepts labels or keys', () => {
    const g = rowsToGrid('Projects', []);
    expect(g[0][0]).toBe('Project ID');
    const rows = gridToRows(TABS.Projects as Column[], [['project_id', 'Project name'], ['NEAS-9', 'Test']]);
    expect(rows[0]).toEqual({ project_id: 'NEAS-9', project_name: 'Test' });
  });
  it('reads formatted Word/PDF cells back (percent, peso, long dates)', () => {
    const s = base();
    s.activeProjectId = 'NEAS-001';
    const p = planActivities(s, [{ activity: 'Glass coating', start: 'Oct 25, 2026', end: 'Oct 28, 2026', weight_pct: '5.0%' }]);
    expect(p.errors).toEqual([]);
    expect(p.next.activities.find((a) => a.name === 'Glass coating')).toMatchObject({ start: '2026-10-25', end: '2026-10-28', weight: 5 });
  });
  it('reads Excel serial dates and ISO dates', () => {
    expect(toDateStr(46311)).toBe('2026-10-16');
    expect(toDateStr('2026-10-16T08:00:00Z')).toBe('2026-10-16');
  });
});

describe('import plans', () => {
  it('activities: updates by name, adds new, rejects bad rows', () => {
    const s = base();
    s.activeProjectId = 'NEAS-001';
    const p = planActivities(s, [
      { activity: 'Rope access facade cleaning', start: '2026-10-05', end: '2026-10-24', weight_pct: 55 },
      { activity: 'Glass coating', start: '2026-10-25', end: '2026-10-28', weight_pct: 5 },
      { activity: 'Broken', start: 'x', end: '2026-10-28', weight_pct: 5 },
    ]);
    expect(p.updated).toBe(1);
    expect(p.added).toBe(1);
    expect(p.errors).toHaveLength(1);
    expect(p.next.activities.find((a) => a.name === 'Rope access facade cleaning')?.end).toBe('2026-10-24');
  });
  it('reports: matches activity by name and skips exact duplicates', () => {
    const s = base();
    const p = planReports(s, [
      { activity: 'NEAS-Q-2026-001', report_date: '2026-10-16', actual_pct: 30, notes: 'Imported from the existing app (latest saved report).' },
      { activity: 'NEAS-Q-2026-001', report_date: '2026-10-18', actual_pct: 45 },
    ]);
    expect(p.added).toBe(1);
    expect(p.next.reports).toHaveLength(2);
  });
  it('BOQ: blocked when the quotation is issued', () => {
    const s = base();
    s.quotations['NEAS-Q-2026-001'] = { projectId: 'NEAS-Q-2026-001', number: 'Q', status: 'Issued', validityDays: 30, terms: '', approvedBy: 'a', approvedAt: 'x', issuedAt: 'y', approvedTotal: 1, history: [] };
    const p = planBoq(s, [{ description: 'Extra', qty: 1, unit_cost_php: 100 }]);
    expect(p.added).toBe(0);
    expect(p.errors[0]).toMatch(/locked/);
  });
});
