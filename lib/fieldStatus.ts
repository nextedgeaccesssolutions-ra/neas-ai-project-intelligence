import { actualPct, latestReport, plannedPct } from './calc';
import { fmtDate, fmtPct } from './format';
import type { Activity, FieldReport } from './types';

export type Tone = 'ok' | 'warn' | 'bad' | 'muted';
export interface ActivityStatus { label: string; tone: Tone; icon: string; detail: string }

/** Plain-language status for one activity, from its latest report against the plan for `day`. */
export function activityStatus(a: Activity, reports: FieldReport[], day: string): ActivityStatus {
  const last = latestReport(a.id, reports, day);
  const planned = plannedPct(a, day);
  if (!last) return { label: 'No report yet', tone: 'muted', icon: '○', detail: `Planned ${fmtPct(planned)} by today` };
  const actual = actualPct(a.id, reports, day);
  const detail = `${fmtPct(actual)} actual · ${fmtPct(planned)} planned · ${fmtDate(last.date)}`;
  if (last.status === 'rejected') return { label: 'Report rejected', tone: 'bad', icon: '✕', detail };
  if (actual >= 100) return { label: 'Complete', tone: 'ok', icon: '✓', detail };
  if (actual + 5 < planned) return { label: 'Behind schedule', tone: 'warn', icon: '⚠', detail };
  return { label: 'On track', tone: 'ok', icon: '✓', detail };
}
