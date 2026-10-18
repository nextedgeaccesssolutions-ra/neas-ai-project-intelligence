'use client';
import { useMemo, useRef, useState } from 'react';
import type { Activity } from '@/lib/types';
import { addDays, daysBetween, toMs, type ProgressPoint } from '@/lib/calc';
import { fmtDate, fmtPct } from '@/lib/format';

const W = 1000;

/** S-curve: planned (full span) and actual (up to the status date). */
export function SCurve({ series, asOf }: { series: ProgressPoint[]; asOf: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const H = 340;
  const M = { t: 16, r: 96, b: 34, l: 48 };
  if (!series.length) return <div className="empty">Add activities in Project management to draw the S-curve.</div>;

  const t0 = toMs(series[0].day);
  const t1 = toMs(series[series.length - 1].day);
  const x = (d: string) => M.l + ((toMs(d) - t0) / Math.max(1, t1 - t0)) * (W - M.l - M.r);
  const y = (v: number) => M.t + (1 - v / 100) * (H - M.t - M.b);
  const actual = series.filter((p) => p.day <= asOf);
  const path = (pts: ProgressPoint[], k: 'planned' | 'actual') => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)},${y(p[k]).toFixed(1)}`).join('');
  const last = series[series.length - 1];
  const cur = series.find((p) => p.day === asOf) ?? (asOf > last.day ? last : series[0]);
  const showAsOf = asOf >= series[0].day && asOf <= last.day;

  const n = series.length;
  const step = Math.max(1, Math.ceil(n / 7));
  const ticks = series.filter((_, i) => i % step === 0);

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - M.l) / (W - M.l - M.r)) * (n - 1));
    setHover(Math.min(n - 1, Math.max(0, i)));
  };
  const hp = hover != null ? series[hover] : null;
  let pyA = y(cur.actual);
  const pyP = y(last.planned);
  if (Math.abs(pyA - pyP) < 16 && showAsOf && x(cur.day) > W - M.r - 60) pyA = pyP + (pyA >= pyP ? 16 : -16);

  return (
    <div className="chart" ref={box}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`S-curve: planned ${fmtPct(cur.planned)}, actual ${fmtPct(cur.actual)} on ${fmtDate(cur.day)}`}>
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} stroke="#e3e9ee" />
            <text x={M.l - 8} y={y(v) + 4} textAnchor="end" fontSize="12" fill="#5d6f7b">{v}%</text>
          </g>
        ))}
        {ticks.map((p) => (
          <text key={p.day} x={x(p.day)} y={H - 10} textAnchor="middle" fontSize="12" fill="#5d6f7b">{fmtDate(p.day, false)}</text>
        ))}
        {showAsOf && (
          <g>
            <line x1={x(asOf)} x2={x(asOf)} y1={M.t} y2={H - M.b} stroke="#8aa0ad" strokeDasharray="4 4" />
            <text x={x(asOf) + 4} y={M.t + 10} fontSize="11" fill="#5d6f7b">Status date</text>
          </g>
        )}
        <path d={path(series, 'planned')} fill="none" stroke="var(--planned)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {actual.length > 0 && <path d={path(actual, 'actual')} fill="none" stroke="var(--gold)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />}
        <text x={W - M.r + 6} y={pyP + 4} fontSize="12" fill="var(--planned)" fontWeight="700">Planned {fmtPct(last.planned)}</text>
        {actual.length > 0 && (
          <text x={Math.min(x(actual[actual.length - 1].day) + 6, W - M.r + 6)} y={pyA + (Math.abs(pyA - pyP) < 16 ? 18 : 4)} fontSize="12" fill="var(--gold-ink)" fontWeight="700">
            Actual {fmtPct(cur.actual)}
          </text>
        )}
        {hp && (
          <g>
            <line x1={x(hp.day)} x2={x(hp.day)} y1={M.t} y2={H - M.b} stroke="#b9c7d0" />
            <circle cx={x(hp.day)} cy={y(hp.planned)} r="4" fill="var(--planned)" />
            {hp.day <= asOf && <circle cx={x(hp.day)} cy={y(hp.actual)} r="4" fill="var(--gold)" />}
          </g>
        )}
        <rect x={M.l} y={M.t} width={W - M.l - M.r} height={H - M.t - M.b} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
      </svg>
      {hp && (
        <div className="tip" style={{ left: `${Math.min(80, (x(hp.day) / W) * 100)}%`, top: 8 }}>
          <div className="note">{fmtDate(hp.day)}</div>
          <div><b style={{ color: 'var(--planned)' }}>Planned</b> {fmtPct(hp.planned)}</div>
          <div><b style={{ color: 'var(--gold-ink)' }}>Actual</b> {hp.day <= asOf ? fmtPct(hp.actual) : 'not yet reported'}</div>
        </div>
      )}
    </div>
  );
}

/** Gantt: planned bar per activity with an actual-progress bar underneath. */
export function Gantt({ rows, asOf, actualOf }: { rows: Activity[]; asOf: string; actualOf: (id: string) => number }) {
  const data = useMemo(() => rows.slice().sort((a, b) => a.start.localeCompare(b.start)), [rows]);
  if (!data.length) return <div className="empty">No activities yet.</div>;
  const start = data.reduce((m, a) => (a.start < m ? a.start : m), data[0].start);
  const end = addDays(data.reduce((m, a) => (a.end > m ? a.end : m), data[0].end), 1);
  const total = Math.max(1, daysBetween(start, end));
  const LW = 260;
  const rowH = 46;
  const H = 28 + data.length * rowH;
  const x = (d: string) => LW + (daysBetween(start, d) / total) * (W - LW - 10);
  const weekTicks: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 7)) weekTicks.push(d);
  const clip = (s: string) => (s.length > 34 ? s.slice(0, 33) + '…' : s);

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Gantt chart of planned activities and reported progress">
        {weekTicks.map((d) => (
          <g key={d}>
            <line x1={x(d)} x2={x(d)} y1={20} y2={H} stroke="#e3e9ee" />
            <text x={x(d)} y={13} textAnchor="middle" fontSize="11" fill="#5d6f7b">{fmtDate(d, false)}</text>
          </g>
        ))}
        {data.map((a, i) => {
          const y0 = 28 + i * rowH;
          const xs = x(a.start);
          const xe = x(addDays(a.end, 1));
          const act = actualOf(a.id);
          return (
            <g key={a.id}>
              <title>{`${a.name}: ${fmtDate(a.start)} – ${fmtDate(a.end)}, weight ${a.weight}%, actual ${fmtPct(act)}`}</title>
              <text x={0} y={y0 + 15} fontSize="13" fill="#0b1f2a">{clip(a.name)}</text>
              <text x={0} y={y0 + 31} fontSize="11" fill="#5d6f7b">Actual {fmtPct(act)} · weight {a.weight}%</text>
              <rect x={LW} y={y0 + 4} width={W - LW - 10} height={18} rx="4" fill="#f1f4f6" />
              <rect x={xs} y={y0 + 4} width={Math.max(3, xe - xs)} height={18} rx="4" fill="var(--planned-soft)" />
              <rect x={xs} y={y0 + 26} width={Math.max(0, ((xe - xs) * act) / 100)} height={5} rx="2.5" fill="var(--gold)" />
            </g>
          );
        })}
        {asOf >= start && asOf <= end && <line x1={x(asOf)} x2={x(asOf)} y1={20} y2={H} stroke="#8aa0ad" strokeDasharray="4 4" />}
      </svg>
    </div>
  );
}
