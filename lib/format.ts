const php = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = new Intl.NumberFormat('en-PH', { maximumFractionDigits: 2 });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const fmtPHP = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? '—' : php.format(x));
export const fmtNum = (x: number) => num.format(x);
export const fmtPct = (x: number) => `${x.toFixed(1)}%`;
export const fmtPP = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(1)} pp`;

/** '2026-10-16' → 'Oct 16, 2026' (no timezone shift) */
export function fmtDate(d: string | null | undefined, withYear = true): string {
  if (!d) return '—';
  const m = MONTHS[Number(d.slice(5, 7)) - 1];
  const day = Number(d.slice(8, 10));
  return withYear ? `${m} ${String(day).padStart(2, '0')}, ${d.slice(0, 4)}` : `${m} ${day}`;
}

/** Record ids: UUIDs (required by the cloud database, also fine on a device). */
export const uid = (_prefix?: string) =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}
