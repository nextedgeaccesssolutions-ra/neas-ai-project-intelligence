'use client';
import { useMemo, useRef, useState } from 'react';
import type { Activity, ActivityStop } from '@/lib/types';
import { STOP_REASONS } from '@/lib/types';
import { localDay } from '@/lib/schedule';
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

/** A proposed (unsaved) change dragged on the Gantt. */
export interface GanttProposal { id: string; start?: string; end?: string; pct?: number }

type Drag = { id: string; mode: 'move' | 'start' | 'end' | 'pct'; x0: number; a: Activity; pct0: number };

/**
 * Gantt: baseline outline, current planned bar, actual progress, actual dates and stoppages per
 * activity. When `editable`, bars can be dragged (edges = start/finish, middle = move) and the
 * progress marker can be dragged; drags only propose a change through `onPropose` — nothing is saved here.
 */
export function Gantt({ rows, asOf, actualOf, stops = [], selected, onSelect, editable, proposal, onPropose }: {
  rows: Activity[]; asOf: string; actualOf: (id: string) => number; stops?: ActivityStop[];
  selected?: string | null; onSelect?: (id: string) => void; editable?: boolean;
  proposal?: GanttProposal | null; onPropose?: (p: GanttProposal) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [live, setLive] = useState<GanttProposal | null>(null);
  const data = useMemo(() => rows.slice().sort((a, b) => a.start.localeCompare(b.start)), [rows]);
  if (!data.length) return <div className="empty">No activities yet.</div>;
  const view = (a: Activity): Activity => {
    const p = live?.id === a.id ? live : proposal?.id === a.id ? proposal : null;
    return p ? { ...a, start: p.start ?? a.start, end: p.end ?? a.end } : a;
  };
  const lo = (a: Activity) => [a.start, a.baselineStart, a.actualStart].filter(Boolean).sort()[0] as string;
  const hi = (a: Activity) => [a.end, a.baselineEnd, a.actualFinish, a.rescheduleEnd].filter(Boolean).sort().reverse()[0] as string;
  const start = data.reduce((m, a) => (lo(a) < m ? lo(a) : m), lo(data[0]));
  const end = addDays(data.reduce((m, a) => (hi(a) > m ? hi(a) : m), hi(data[0])), 1);
  const total = Math.max(1, daysBetween(start, end));
  const LW = 260;
  const rowH = 52;
  const H = 28 + data.length * rowH;
  const span = W - LW - 10;
  const x = (d: string) => LW + (daysBetween(start, d) / total) * span;
  const weekTicks: string[] = [];
  // a date about every tenth of the chart: daily for a short job, weekly or monthly for long ones
  const tickStep = [1, 2, 3, 7, 14, 30, 61, 91].find((n) => total / n <= 12) ?? 182;
  for (let d = start; d <= end; d = addDays(d, tickStep)) weekTicks.push(d);
  const clip = (s: string) => (s.length > 34 ? s.slice(0, 33) + '…' : s);

  const svgX = (clientX: number) => {
    const m = svg.current?.getScreenCTM();
    return m ? (clientX - m.e) / m.a : 0;
  };
  const begin = (e: React.PointerEvent, a: Activity, mode: Drag['mode']) => {
    if (!editable) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    onSelect?.(a.id);
    setDrag({ id: a.id, mode, x0: svgX(e.clientX), a: view(a), pct0: proposal?.id === a.id && proposal.pct != null ? proposal.pct : actualOf(a.id) });
  };
  const move = (e: React.PointerEvent) => {
    if (!drag) return;
    const dx = svgX(e.clientX) - drag.x0;
    const days = Math.round((dx / span) * total);
    const { a } = drag;
    if (drag.mode === 'pct') {
      const w = Math.max(1, x(addDays(a.end, 1)) - x(a.start));
      setLive({ id: a.id, pct: Math.round(Math.min(100, Math.max(0, drag.pct0 + (dx / w) * 100))) });
      return;
    }
    const s = drag.mode === 'end' ? a.start : addDays(a.start, days);
    let en = drag.mode === 'start' ? a.end : addDays(a.end, days);
    if (en < s) en = s;
    setLive({ id: a.id, start: drag.mode === 'end' ? undefined : s, end: drag.mode === 'start' ? undefined : en });
  };
  const finish = () => {
    if (drag && live) {
      const base = proposal?.id === live.id ? proposal : { id: live.id };
      onPropose?.({ ...base, ...Object.fromEntries(Object.entries(live).filter(([, v]) => v !== undefined)) } as GanttProposal);
    }
    setDrag(null);
    setLive(null);
  };

  return (
    <div className="chart" style={{ touchAction: drag ? 'none' : undefined }}>
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Gantt chart of planned activities, actual progress and stoppages"
        onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} style={{ userSelect: 'none' }}>
        <defs>
          <pattern id="stop-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="#fbe3e1" /><line x1="0" y1="0" x2="0" y2="6" stroke="#c0392b" strokeWidth="2.5" />
          </pattern>
        </defs>
        {weekTicks.map((d) => (
          <g key={d}>
            <line x1={x(d)} x2={x(d)} y1={20} y2={H} stroke="#e3e9ee" />
            <text x={x(d)} y={13} textAnchor="middle" fontSize="11" fill="#5d6f7b">{fmtDate(d, false)}</text>
          </g>
        ))}
        {data.map((orig, i) => {
          const a = view(orig);
          const y0 = 28 + i * rowH;
          const xs = x(a.start);
          const xe = x(addDays(a.end, 1));
          const pending = (live?.id === a.id && live.pct != null) ? live.pct : proposal?.id === a.id ? proposal.pct : undefined;
          const act = pending ?? actualOf(a.id);
          const mine = stops.filter((s) => s.activityId === a.id);
          const open = mine.find((s) => !s.restartedAt);
          const changed = (live?.id === a.id) || (proposal?.id === a.id);
          const isSel = selected === a.id;
          return (
            <g key={a.id} onClick={() => onSelect?.(a.id)} style={{ cursor: onSelect ? 'pointer' : undefined }}>
              <title>{`${a.name}: ${fmtDate(a.start)} – ${fmtDate(a.end)}${a.baselineStart && (a.baselineStart !== a.start || a.baselineEnd !== a.end) ? ` (baseline ${fmtDate(a.baselineStart)} – ${fmtDate(a.baselineEnd ?? a.end)})` : ''}${a.actualStart ? `, actual from ${fmtDate(a.actualStart)}` : ''}, weight ${a.weight}%, actual ${fmtPct(act)}${open ? ', STOPPED' : ''}`}</title>
              {isSel && <rect x={0} y={y0 - 2} width={W} height={rowH - 4} fill="#fff8ea" />}
              <text x={0} y={y0 + 15} fontSize="13" fill="#0b1f2a" fontWeight={isSel ? 600 : 400}>{clip(a.name)}</text>
              <text x={0} y={y0 + 31} fontSize="11" fill={open ? '#c0392b' : '#5d6f7b'}>{open ? 'STOPPED · ' : ''}Actual {fmtPct(act)} · weight {a.weight}%</text>
              <rect x={LW} y={y0 + 4} width={span} height={18} rx="4" fill="#f1f4f6" />
              {a.baselineStart && a.baselineEnd && (a.baselineStart !== a.start || a.baselineEnd !== a.end) && (
                <rect x={x(a.baselineStart)} y={y0 + 2} width={Math.max(3, x(addDays(a.baselineEnd, 1)) - x(a.baselineStart))} height={22} rx="4" fill="none" stroke="#5d6f7b" strokeDasharray="3 3">
                  <title>{`Baseline ${fmtDate(a.baselineStart)} – ${fmtDate(a.baselineEnd)}`}</title>
                </rect>
              )}
              <rect x={xs} y={y0 + 4} width={Math.max(3, xe - xs)} height={18} rx="4" fill="var(--planned-soft)"
                stroke={changed ? 'var(--gold)' : undefined} strokeWidth={changed ? 2 : undefined}
                style={{ cursor: editable ? 'grab' : undefined }} onPointerDown={(e) => begin(e, orig, 'move')} />
              {a.rescheduleStart && a.rescheduleEnd && (
                <g>
                  <line x1={xe} y1={y0 + 13} x2={x(a.rescheduleStart)} y2={y0 + 13} stroke="#b9770e" strokeDasharray="2 3" />
                  <rect x={x(a.rescheduleStart)} y={y0 + 4} width={Math.max(3, x(addDays(a.rescheduleEnd, 1)) - x(a.rescheduleStart))} height={18} rx="4"
                    fill="#fdebd0" stroke="#b9770e" strokeWidth={1.5}>
                    <title>{`Rescheduled ${fmtDate(a.rescheduleStart)} – ${fmtDate(a.rescheduleEnd)}${a.delayReason ? `: ${a.delayReason}` : ''}`}</title>
                  </rect>
                </g>
              )}
              {mine.map((s) => {
                const from = localDay(s.stoppedAt);
                const to = s.restartedAt ? localDay(s.restartedAt) : asOf;
                if (to < from) return null;
                return (
                  <g key={s.id}>
                    <rect x={x(from)} y={y0 + 4} width={Math.max(3, x(addDays(to, s.restartedAt ? 0 : 1)) - x(from))} height={18} fill="url(#stop-hatch)" opacity={0.9}>
                      <title>{`Stopped ${fmtDate(from)}${s.restartedAt ? ` – restarted ${fmtDate(to)}` : ' (still stopped)'}: ${STOP_REASONS.find((r) => r.value === s.reason)?.label ?? s.reason}`}</title>
                    </rect>
                    {s.restartedAt && <path d={`M ${x(to)} ${y0 + 1} l 5 -5 l -10 0 z`} fill="#1e8449"><title>{`Restarted ${fmtDate(to)}`}</title></path>}
                  </g>
                );
              })}
              {editable && (
                <>
                  <rect x={xs - 4} y={y0 + 4} width={8} height={18} fill="transparent" style={{ cursor: 'ew-resize' }} onPointerDown={(e) => begin(e, orig, 'start')}><title>Drag to change the planned start</title></rect>
                  <rect x={xe - 4} y={y0 + 4} width={8} height={18} fill="transparent" style={{ cursor: 'ew-resize' }} onPointerDown={(e) => begin(e, orig, 'end')}><title>Drag to change the planned finish</title></rect>
                </>
              )}
              <rect x={xs} y={y0 + 26} width={Math.max(0, ((xe - xs) * act) / 100)} height={5} rx="2.5" fill={pending != null ? 'var(--gold-ink)' : 'var(--gold)'} />
              {editable && (
                <circle cx={xs + ((xe - xs) * act) / 100} cy={y0 + 28.5} r={6} fill="#fff" stroke="var(--gold-ink)" strokeWidth={2} style={{ cursor: 'ew-resize' }} onPointerDown={(e) => begin(e, orig, 'pct')}>
                  <title>Drag to propose a new actual progress</title>
                </circle>
              )}
              {a.actualStart && <rect x={x(a.actualStart)} y={y0 + 36} width={Math.max(3, x(addDays(a.actualFinish ?? (asOf > a.actualStart ? asOf : a.actualStart), 1)) - x(a.actualStart))} height={3} fill="#0b1f2a" opacity={0.55} />}
            </g>
          );
        })}
        {asOf >= start && asOf <= end && <line x1={x(asOf)} x2={x(asOf)} y1={20} y2={H} stroke="#8aa0ad" strokeDasharray="4 4" />}
        {live && (live.start || live.end) && (() => {
          const a = view(data.find((r) => r.id === live.id)!);
          return <text x={W - 10} y={13} textAnchor="end" fontSize="11" fontWeight={600} fill="var(--gold-ink)">{`${fmtDate(a.start)} – ${fmtDate(a.end)}`}</text>;
        })()}
        {live?.pct != null && <text x={W - 10} y={13} textAnchor="end" fontSize="11" fontWeight={600} fill="var(--gold-ink)">{`Proposed actual ${live.pct}%`}</text>}
      </svg>
    </div>
  );
}
