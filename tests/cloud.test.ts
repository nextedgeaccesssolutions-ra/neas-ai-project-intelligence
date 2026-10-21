import { describe, expect, it } from 'vitest';
import { checkEmail, checkName, checkPassword } from '../lib/cloud/validate';
import { buildClientView, todayIn, type SnapshotInput } from '../lib/cloud/clientView';
import { bundleToState, withProjectCodes, type DbBundle } from '../lib/cloud/mapping';
import { emptyState } from '../lib/seed';

describe('registration validation', () => {
  it('accepts normal addresses and normalises case', () => {
    expect(checkEmail('  Juan.Dela-Cruz@NextEdge.ph ')).toEqual({ ok: true, email: 'juan.dela-cruz@nextedge.ph' });
  });
  it('refuses malformed and disposable addresses', () => {
    expect(checkEmail('not-an-email').ok).toBe(false);
    expect(checkEmail('a@b').ok).toBe(false);
    expect(checkEmail('x@mailinator.com').ok).toBe(false);
    expect(checkEmail('x@sub.yopmail.com').ok).toBe(false);
  });
  it('validates names', () => {
    expect(checkName('J').ok).toBe(false);
    expect(checkName('<script>').ok).toBe(false);
    expect(checkName('  Maria   Santos ')).toEqual({ ok: true, name: 'Maria Santos' });
  });
  it('enforces the password policy', () => {
    expect(checkPassword('short')).not.toEqual([]);
    expect(checkPassword('alllowercaseletters')).not.toEqual([]);
    expect(checkPassword('Password12345!')).not.toEqual([]); // obvious word
    expect(checkPassword('Rope-Access-7-Makati')).toEqual([]);
  });
});

describe('client portal view', () => {
  const snap: SnapshotInput = {
    project: { code: 'PRJ-2026-001', name: 'Facade Cleaning', status: 'active' },
    visibility: { show_overview: true, show_progress: true, show_milestones: true, show_gantt: true, show_scurve: false, show_reports: true, show_photos: false, show_documents: false, show_completion: false },
    session_expires_at: '2026-10-18T10:00:00Z',
    generated_at: '2026-10-18T02:00:00Z',
    activities: [
      { id: 'a1', name: 'Mobilization', start_date: '2026-10-01', end_date: '2026-10-04', weight: 10, is_milestone: true },
      { id: 'a2', name: 'Cleaning', start_date: '2026-10-05', end_date: '2026-10-22', weight: 90, is_milestone: false },
    ],
    progress: [{ activity_id: 'a1', report_date: '2026-10-03', actual_pct: 100 }],
    reports: [{ report_date: '2026-10-03', report_type: 'progress', activity: 'Mobilization', actual_pct: 100, notes: 'Done' }],
  };
  it('computes progress only from approved progress it was given', () => {
    const v = buildClientView(snap, '2026-10-04');
    expect(v.progress?.actual).toBeCloseTo(10, 6);
    expect(v.progress?.planned).toBeCloseTo(10, 6);
    expect(v.milestones).toEqual([{ name: 'Mobilization', date: '2026-10-04', done: true }]);
  });
  it('leaves out every section that is switched off', () => {
    const v = buildClientView(snap, '2026-10-04');
    expect(v.scurve).toBeUndefined();
    expect(v.files).toBeUndefined();
    expect(v.completion).toBeUndefined();
    expect(JSON.stringify(v)).not.toMatch(/contract|unit_cost|boq/i);
  });
  it('formats today in Manila time', () => {
    expect(todayIn('Asia/Manila', new Date('2026-10-17T20:30:00Z'))).toBe('2026-10-18');
  });
});

describe('database ↔ app mapping', () => {
  const bundle: DbBundle = {
    projects: [{ id: 'p-uuid', code: 'PRJ-2026-001', name: 'Alpha', reference_no: '', client_name: 'ACME', site: 'Makati', status: 'active', start_date: null, end_date: null, contract_value: '1250000.00', client_portal_enabled: false, version: 1, created_at: '2026-10-18T00:00:00Z' }],
    activities: [{ id: 'a', project_id: 'p-uuid', name: 'X', start_date: '2026-10-01', end_date: '2026-10-02', weight: '100.00', is_milestone: false, client_visible: true, sort_order: 0, version: 3, deleted_at: null }],
    reports: [{ id: 'r', project_id: 'p-uuid', activity_id: 'a', report_type: 'progress', report_date: '2026-10-01', actual_pct: '50.00', notes: '', status: 'approved', client_visible: true, submitted_by: null, version: 1, created_at: '2026-10-01T00:00:00Z', deleted_at: null }],
    boq: [], costs: [], quotes: [],
    attachments: [{ id: 'f', project_id: 'p-uuid', report_id: null, activity_id: 'a', kind: 'after', storage_path: 'p-uuid/f.jpg', caption: 'done', mime_type: 'image/jpeg', bytes: 10, client_visible: false, created_at: '2026-10-02T00:00:00Z', version: 1, deleted_at: '2026-10-03T00:00:00Z' }],
  };
  it('converts numeric strings and drops deleted rows', () => {
    const st = bundleToState(bundle, emptyState());
    expect(st.projects[0]).toMatchObject({ id: 'p-uuid', code: 'PRJ-2026-001', contractValue: 1250000, client: 'ACME' });
    expect(st.activities[0].weight).toBe(100);
    expect(st.reports[0]).toMatchObject({ actualPct: 50, status: 'approved', clientVisible: true });
    expect(st.evidence).toHaveLength(0);
  });
  it('shows project codes, not UUIDs, in the Google Sheet', () => {
    const st = withProjectCodes(bundleToState(bundle, emptyState()));
    expect(st.projects[0].id).toBe('PRJ-2026-001');
    expect(st.activities[0].projectId).toBe('PRJ-2026-001');
  });
});
