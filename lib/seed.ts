import type { AppState } from './types';

export function seedState(now = new Date().toISOString()): AppState {
  return {
    version: 1,
    activeProjectId: 'NEAS-Q-2026-001',
    userName: '',
    projects: [
      { id: 'NEAS-Q-2026-001', name: 'NEAS-Q-2026-001', client: '', site: '', status: 'active', contractValue: 100000, createdAt: now },
      { id: 'NEAS-001', name: 'Facade Cleaning', client: '', site: '', status: 'active', contractValue: null, createdAt: now },
    ],
    activities: [
      { id: 'act_q1', projectId: 'NEAS-Q-2026-001', name: 'NEAS-Q-2026-001', start: '2026-10-16', end: '2026-10-23', weight: 100 },
      { id: 'act_a1', projectId: 'NEAS-001', name: 'Mobilization and access setup', start: '2026-10-01', end: '2026-10-04', weight: 10 },
      { id: 'act_a2', projectId: 'NEAS-001', name: 'Rope access facade cleaning', start: '2026-10-05', end: '2026-10-22', weight: 55 },
      { id: 'act_a3', projectId: 'NEAS-001', name: 'Window detailing and QC', start: '2026-10-15', end: '2026-10-28', weight: 25 },
      { id: 'act_a4', projectId: 'NEAS-001', name: 'Demobilization and handover', start: '2026-10-29', end: '2026-10-31', weight: 10 },
    ],
    reports: [
      { id: 'rep_seed1', projectId: 'NEAS-Q-2026-001', activityId: 'act_q1', date: '2026-10-16', actualPct: 30, notes: 'Imported from the existing app (latest saved report).', createdAt: now },
    ],
    boq: [],
    costSettings: {},
    quotations: {},
    evidence: [],
    savedAt: null,
  };
}

/** Empty starting state for cloud mode (real data comes from the server). */
export function emptyState(): AppState {
  return { ...seedState(), activeProjectId: '', projects: [], activities: [], reports: [], boq: [], costSettings: {}, quotations: {}, evidence: [], savedAt: null };
}
