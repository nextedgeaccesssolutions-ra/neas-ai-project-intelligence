import { describe, expect, it } from 'vitest';
import { activityStatus } from '../lib/fieldStatus';
import type { Activity, FieldReport } from '../lib/types';

const act: Activity = { id: 'a1', projectId: 'p', name: 'Facade cleaning', start: '2026-10-01', end: '2026-10-10', weight: 50 };
const rep = (date: string, pct: number, extra: Partial<FieldReport> = {}): FieldReport =>
  ({ id: date + pct, projectId: 'p', activityId: 'a1', date, actualPct: pct, notes: '', createdAt: date + 'T00:00:00Z', ...extra });

describe('walkthrough report status', () => {
  it('no report yet', () => expect(activityStatus(act, [], '2026-10-05').label).toBe('No report yet'));
  it('on track when actual is within 5 pp of plan', () => expect(activityStatus(act, [rep('2026-10-05', 47)], '2026-10-05').label).toBe('On track'));
  it('behind schedule when more than 5 pp below plan', () => {
    const s = activityStatus(act, [rep('2026-10-05', 30)], '2026-10-05');
    expect(s.label).toBe('Behind schedule');
    expect(s.tone).toBe('warn');
  });
  it('complete at 100%', () => expect(activityStatus(act, [rep('2026-10-04', 100)], '2026-10-05').label).toBe('Complete'));
  it('rejected latest report is flagged', () => expect(activityStatus(act, [rep('2026-10-05', 60, { status: 'rejected' })], '2026-10-05').tone).toBe('bad'));
});
