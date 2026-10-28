import { describe, expect, it } from 'vitest';
import { reportFromDb, reportToDb, type DbReport } from '../lib/cloud/mapping';
import { reportNo } from '../lib/fieldReportPdf';
import type { FieldReport } from '../lib/types';

const details: NonNullable<FieldReport['details']> = {
  type: 'Issue', location: 'Makati City', area: 'Gamboa Side', floor: 'Floor 40', weather: 'Sunny', description: 'Facade glass cleaning.',
  tasks: [{ label: 'Glass cleaning', done: true }], materials: [{ name: 'Microfiber cloth', qty: 10, unit: 'pcs' }], remarks: 'Turned over.',
  signers: [{ role: 'Technician / Inspector', name: 'J. Granaderos', photoId: 'p1', at: '2026-10-28T01:00:00Z' }], photos: [{ id: 'b1', kind: 'Before' }],
};
const r: FieldReport = { id: 'a1b2c3d4-0000-4000-8000-000000000000', projectId: 'p', activityId: 'act', date: '2026-10-28', actualPct: 40, completedQty: null, notes: 'n', createdAt: '2026-10-28T00:00:00Z', details };

describe('step-by-step field report details', () => {
  it('are sent in data, with the closest database report type', () => {
    const db = reportToDb(r);
    expect(db.data).toEqual(details);
    expect(db.report_type).toBe('daily');
    expect(reportToDb({ ...r, details: { ...details, type: 'Inspection' } }).report_type).toBe('inspection');
  });
  it('a plain report sends no data and stays a progress report', () => {
    const db = reportToDb({ ...r, details: undefined });
    expect('data' in db).toBe(false);
    expect(db.report_type).toBe('progress');
  });
  it('come back from the database unchanged; old reports have none', () => {
    const row: DbReport = { id: r.id, project_id: 'p', activity_id: 'act', report_type: 'daily', report_date: r.date, actual_pct: 40, notes: 'n', data: details as unknown as Record<string, unknown>, status: 'submitted', client_visible: false, submitted_by: null, version: 1, created_at: r.createdAt, deleted_at: null };
    expect(reportFromDb(row).details).toEqual(details);
    expect(reportFromDb({ ...row, data: {} }).details).toBeUndefined();
  });
  it('report number is readable and stable', () => {
    expect(reportNo(r)).toBe('FR-20261028-A1B2');
  });
});
