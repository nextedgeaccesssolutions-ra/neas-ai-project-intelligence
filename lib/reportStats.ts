// Report library and dashboard counts. Pure functions over loaded records, so every number can be
// checked against a database query. A "report" is one field report or one generated project report;
// shares, opens and e-mails are counted separately and never inflate report counts.

export type ReportKind = 'field' | 'project';
export interface ReportRow {
  id: string;
  kind: ReportKind;
  ref: string;
  title: string;
  projectId: string;
  projectCode: string;
  createdBy: string | null;
  createdAt: string; // ISO timestamp
  updatedAt: string;
  /** field reports: draft | submitted | approved | rejected; project reports: generated */
  status: string;
  format: string;
}
export interface ShareRow { id: string; project_id: string; method: 'link' | 'qr' | 'email'; created_at: string; expires_at: string; revoked_at: string | null }

/** Calendar day (YYYY-MM-DD) of a timestamp in the reporting time zone (Philippine time), wherever the viewer is. */
const DAY_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' });
export const localDay = (iso: string) => DAY_FMT.format(new Date(iso));

export const KIND_LABEL: Record<ReportKind, string> = { field: 'Field report', project: 'Project report (PDF)' };
export const STATUS_LABEL: Record<string, string> = { draft: 'Draft', submitted: 'Pending review', approved: 'Approved', rejected: 'Rejected', generated: 'Generated' };

export const activeShare = (s: Pick<ShareRow, 'revoked_at' | 'expires_at'>, now = Date.now()) => !s.revoked_at && Date.parse(s.expires_at) > now;

export function kpis(rows: ReportRow[], shares: ShareRow[], activeProjectIds: Set<string>, today: string, now = Date.now()) {
  const month = today.slice(0, 7);
  const unique = new Map(rows.map((r) => [`${r.kind}:${r.id}`, r]));
  const all = [...unique.values()];
  const sharedProjects = new Set(shares.filter((s) => activeShare(s, now)).map((s) => s.project_id));
  return {
    total: all.length,
    today: all.filter((r) => localDay(r.createdAt) === today).length,
    month: all.filter((r) => localDay(r.createdAt).startsWith(month)).length,
    pending: all.filter((r) => r.status === 'submitted').length,
    approved: all.filter((r) => r.status === 'approved').length,
    needsAttention: all.filter((r) => r.status === 'rejected' || r.status === 'draft').length,
    sharedProjects: sharedProjects.size,
    activeCovered: new Set(all.filter((r) => activeProjectIds.has(r.projectId)).map((r) => r.projectId)).size,
  };
}

/** Days from `from` to `to` inclusive (YYYY-MM-DD). */
export function dayRange(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end && out.length < 400) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export function countBy<T>(items: T[], key: (t: T) => string): { label: string; value: number }[] {
  const m = new Map<string, number>();
  for (const i of items) m.set(key(i), (m.get(key(i)) ?? 0) + 1);
  return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

export function perDay(rows: ReportRow[], days: string[]) {
  const m = new Map(days.map((d) => [d, 0]));
  for (const r of rows) {
    const d = localDay(r.createdAt);
    if (m.has(d)) m.set(d, m.get(d)! + 1);
  }
  return days.map((d) => ({ label: d, value: m.get(d)! }));
}

export function perMonth(rows: ReportRow[], months = 6, today: string) {
  const [y, mo] = today.split('-').map(Number);
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(y, mo - 1 - i, 1);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return keys.map((k) => ({ label: k, value: rows.filter((r) => localDay(r.createdAt).startsWith(k)).length }));
}
