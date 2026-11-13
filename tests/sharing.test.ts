import { describe, expect, it } from 'vitest';
import { buildShareEmail, defaultSubject, validEmail } from '../lib/shareEmail';
import { activeShare, countBy, dayRange, kpis, perDay, type ReportRow, type ShareRow } from '../lib/reportStats';

const base = { projectCode: 'NEAS-0027-3-26', projectName: 'Notch Window Cleaning', senderName: 'Junrey', message: '', link: 'https://neas-platform-preview.vercel.app/share#abc', expiresAt: '2026-10-30T08:00:00Z' };

describe('share e-mail', () => {
  it('validates addresses', () => {
    expect(validEmail('client@example.com')).toBe(true);
    expect(validEmail('a@b')).toBe(false);
    expect(validEmail('x@y.com, z@w.com')).toBe(false);
    expect(validEmail('<x@y.com>')).toBe(false);
  });
  it('uses the agreed default subject', () => {
    expect(defaultSubject('P-1', 'Tower')).toBe('NEAS Project Report — Tower — P-1');
  });
  it('escapes HTML and keeps the subject on one line', () => {
    const m = buildShareEmail({ ...base, senderName: '<script>x</script>', message: 'Hi <b>there</b> & "you"', subject: 'Hello\r\nBcc: evil@x.com' });
    expect(m.html).not.toContain('<script>');
    expect(m.html).toContain('&lt;b&gt;there&lt;/b&gt; &amp; &quot;you&quot;');
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.text).toContain(base.link);
    expect(m.html).toContain('href="https://neas-platform-preview.vercel.app/share#abc"');
  });
});

const row = (p: Partial<ReportRow>): ReportRow => ({ id: 'r1', kind: 'field', ref: 'FR-1', title: 't', projectId: 'p1', projectCode: 'P1', createdBy: null, createdAt: '2026-10-23T02:00:00+08:00', updatedAt: '2026-10-23T02:00:00', status: 'submitted', format: 'record', ...p });

describe('report counts', () => {
  const now = Date.parse('2026-10-23T12:00:00');
  const shares: ShareRow[] = [
    { id: 's1', project_id: 'p1', method: 'qr', created_at: '2026-10-20T00:00:00Z', expires_at: '2026-10-30T00:00:00Z', revoked_at: null },
    { id: 's2', project_id: 'p1', method: 'email', created_at: '2026-10-20T00:00:00Z', expires_at: '2026-10-30T00:00:00Z', revoked_at: null },
    { id: 's3', project_id: 'p2', method: 'link', created_at: '2026-10-01T00:00:00Z', expires_at: '2026-10-02T00:00:00Z', revoked_at: null },
  ];
  it('counts each report once, whatever its shares', () => {
    const rows = [row({}), row({}), row({ id: 'r2', status: 'approved', createdAt: '2026-10-01T02:00:00+08:00' }), row({ id: 'x1', kind: 'project', status: 'generated', projectId: 'p3', createdAt: '2026-09-30T02:00:00+08:00' })];
    const k = kpis(rows, shares, new Set(['p1', 'p2']), '2026-10-23', now);
    expect(k.total).toBe(3);
    expect(k.today).toBe(1);
    expect(k.month).toBe(2);
    expect(k.pending).toBe(1);
    expect(k.approved).toBe(1);
    expect(k.sharedProjects).toBe(1); // p2's link expired; two links on p1 count once
    expect(k.activeCovered).toBe(1);
  });
  it('treats withdrawn and expired links as inactive', () => {
    expect(activeShare({ revoked_at: null, expires_at: '2026-10-30T00:00:00Z' }, now)).toBe(true);
    expect(activeShare({ revoked_at: '2026-10-21T00:00:00Z', expires_at: '2026-10-30T00:00:00Z' }, now)).toBe(false);
    expect(activeShare({ revoked_at: null, expires_at: '2026-10-22T00:00:00Z' }, now)).toBe(false);
  });
  it('builds per-day series with empty days', () => {
    const days = dayRange('2026-10-21', '2026-10-23');
    expect(days).toEqual(['2026-10-21', '2026-10-22', '2026-10-23']);
    expect(perDay([row({}), row({ id: 'r9', createdAt: '2026-10-21T09:00:00+08:00' })], days).map((d) => d.value)).toEqual([1, 0, 1]);
    expect(countBy([row({}), row({ id: 'b' }), row({ id: 'c', status: 'approved' })], (r) => r.status)).toEqual([{ label: 'submitted', value: 2 }, { label: 'approved', value: 1 }]);
  });
});
