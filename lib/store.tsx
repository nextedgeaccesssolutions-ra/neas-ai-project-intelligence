'use client';
// Device data store: one JSON document in localStorage, versioned, synced across tabs.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Activity, ActivityStop, AppState, BoqLine, CostSettings, Evidence, FieldReport, Project, Quotation } from './types';
import { DEFAULT_COST_SETTINGS } from './types';
import { emptyState, seedState } from './seed';
export { emptyState, seedState };
import { boqTotals } from './calc';
import { DEFAULT_CALENDAR, type WorkCalendar } from './schedule';
import { newQuotation, returnToDraft } from './quote';
import { deletePhoto } from './photos';
import { initSync, queueSync } from './sheetsSync';
import { CLOUD } from './cloud/env';
import { cloudBoot, cloudOnChange } from './cloud/cloudSync';

// Cloud mode keeps a separate cache so device-mode sample data never mixes with live data.
const KEY = CLOUD ? 'neas-pc-cloud-cache-v1' : 'neas-pc-state-v1';



function load(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as AppState;
      if (s && s.version === 1 && Array.isArray(s.projects)) return { ...(CLOUD ? emptyState() : seedState()), ...s };
    }
  } catch {
    /* corrupted or blocked storage → fall back to seed */
  }
  return CLOUD ? emptyState() : seedState();
}

interface StoreApi {
  ready: boolean;
  state: AppState;
  persistError: string | null;
  project: Project | undefined;
  setActiveProject: (id: string) => void;
  setUserName: (n: string) => void;
  upsertProject: (p: Project) => void;
  deleteProject: (id: string) => void;
  upsertActivity: (a: Activity) => void;
  deleteActivity: (id: string) => void;
  addReport: (r: FieldReport) => void;
  deleteReport: (id: string) => void;
  upsertBoq: (l: BoqLine) => void;
  deleteBoq: (id: string) => void;
  setCostSettings: (projectId: string, s: CostSettings) => void;
  costSettingsFor: (projectId: string) => CostSettings;
  quotationFor: (projectId: string) => Quotation;
  setQuotation: (q: Quotation) => void;
  setCalendar: (projectId: string, c: WorkCalendar) => void;
  stopWork: (s: ActivityStop) => void;
  restartWork: (id: string, r: Pick<ActivityStop, 'restartedAt' | 'restartSupervisor' | 'restartRemarks' | 'safetyCleared' | 'remainingDays'>) => void;
  calendarFor: (projectId: string) => WorkCalendar;
  addEvidence: (e: Evidence) => void;
  updateEvidence: (id: string, patch: Partial<Evidence>) => void;
  deleteEvidence: (id: string) => void;
  replaceAll: (s: AppState) => void;
  resetDemo: () => void;
}

const Ctx = createContext<StoreApi | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(() => seedState('1970-01-01T00:00:00.000Z'));
  const [ready, setReady] = useState(false);
  const [persistError, setPersistError] = useState<string | null>(null);
  const skipSave = useRef(true);
  const fromServer = useRef(false);
  const prevRef = useRef<AppState | null>(null);
  const stateRef = useRef<AppState>(state);
  stateRef.current = state;

  useEffect(() => {
    const initial = load();
    setState(initial);
    setReady(true);
    prevRef.current = initial;
    if (CLOUD) {
      cloudBoot(
        (s) => {
          fromServer.current = true;
          setState(s);
        },
        () => stateRef.current,
      ).catch(() => undefined);
    } else {
      initSync(initial, initial.userName).catch(() => undefined);
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) {
        skipSave.current = true;
        setState(load());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      setPersistError(null);
    } catch (err) {
      setPersistError(err instanceof Error ? err.message : 'Could not save on this device');
    }
    if (CLOUD) {
      // local edits become outbox operations; server refreshes do not
      const prev = prevRef.current;
      prevRef.current = state;
      if (fromServer.current) fromServer.current = false;
      else if (prev) void cloudOnChange(prev, state);
    } else {
      // device mode: every local change is mirrored to the NEAS Google Sheet (debounced)
      queueSync(state, state.userName);
    }
  }, [state, ready]);

  const update = useCallback((fn: (s: AppState) => AppState) => {
    setState((s) => ({ ...fn(s), savedAt: new Date().toISOString() }));
  }, []);

  const api = useMemo<StoreApi>(() => {
    const now = () => new Date().toISOString();
    const costSettingsFor = (pid: string) => state.costSettings[pid] ?? DEFAULT_COST_SETTINGS;
    const quotationFor = (pid: string) => state.quotations[pid] ?? newQuotation(pid, now());
    // Any BOQ or cost change sends a Submitted/Approved quotation back to Draft.
    const touchQuote = (s: AppState, pid: string, reason: string): AppState => {
      const q = s.quotations[pid];
      if (!q || q.status === 'Draft' || q.status === 'Issued') return s;
      return { ...s, quotations: { ...s.quotations, [pid]: returnToDraft(q, s.userName || 'user', now(), reason) } };
    };
    return {
      ready,
      state,
      persistError,
      project: state.projects.find((p) => p.id === state.activeProjectId) ?? state.projects[0],
      setActiveProject: (id) => update((s) => ({ ...s, activeProjectId: id })),
      setUserName: (n) => update((s) => ({ ...s, userName: n })),
      upsertProject: (p) =>
        update((s) => {
          const exists = s.projects.some((x) => x.id === p.id);
          return { ...s, projects: exists ? s.projects.map((x) => (x.id === p.id ? p : x)) : [...s.projects, p] };
        }),
      deleteProject: (id) =>
        update((s) => {
          const ev = s.evidence.filter((e) => e.projectId === id);
          ev.forEach((e) => deletePhoto(e.id).catch(() => undefined));
          const projects = s.projects.filter((p) => p.id !== id);
          const { [id]: _c, ...costSettings } = s.costSettings;
          const { [id]: _q, ...quotations } = s.quotations;
          return {
            ...s,
            projects,
            activeProjectId: s.activeProjectId === id ? projects[0]?.id ?? '' : s.activeProjectId,
            activities: s.activities.filter((a) => a.projectId !== id),
            reports: s.reports.filter((r) => r.projectId !== id),
            boq: s.boq.filter((b) => b.projectId !== id),
            evidence: s.evidence.filter((e) => e.projectId !== id),
            costSettings,
            quotations,
          };
        }),
      upsertActivity: (a) =>
        update((s) => {
          const exists = s.activities.some((x) => x.id === a.id);
          return { ...s, activities: exists ? s.activities.map((x) => (x.id === a.id ? a : x)) : [...s.activities, a] };
        }),
      deleteActivity: (id) =>
        update((s) => ({
          ...s,
          activities: s.activities.filter((a) => a.id !== id),
          reports: s.reports.filter((r) => r.activityId !== id),
        })),
      addReport: (r) => update((s) => ({ ...s, reports: [...s.reports, r] })),
      deleteReport: (id) => update((s) => ({ ...s, reports: s.reports.filter((r) => r.id !== id) })),
      upsertBoq: (l) =>
        update((s) => {
          const exists = s.boq.some((x) => x.id === l.id);
          const next = { ...s, boq: exists ? s.boq.map((x) => (x.id === l.id ? l : x)) : [...s.boq, l] };
          return touchQuote(next, l.projectId, 'BOQ edited');
        }),
      deleteBoq: (id) =>
        update((s) => {
          const line = s.boq.find((b) => b.id === id);
          const next = { ...s, boq: s.boq.filter((b) => b.id !== id) };
          return line ? touchQuote(next, line.projectId, 'BOQ line removed') : next;
        }),
      setCostSettings: (pid, cs) =>
        update((s) => touchQuote({ ...s, costSettings: { ...s.costSettings, [pid]: cs } }, pid, 'Cost settings changed')),
      costSettingsFor,
      quotationFor,
      setQuotation: (q) => update((s) => ({ ...s, quotations: { ...s.quotations, [q.projectId]: q } })),
      stopWork: (st) => update((s) => ({ ...s, stops: [...(s.stops ?? []), st] })),
      restartWork: (id, r) => update((s) => ({ ...s, stops: (s.stops ?? []).map((x) => (x.id === id && !x.restartedAt ? { ...x, ...r } : x)) })),
      setCalendar: (pid, c) => update((s) => ({ ...s, calendars: { ...s.calendars, [pid]: c } })),
      calendarFor: (pid) => state.calendars?.[pid] ?? DEFAULT_CALENDAR,
      addEvidence: (e) => update((s) => ({ ...s, evidence: [...s.evidence, e] })),
      updateEvidence: (id, patch) => update((s) => ({ ...s, evidence: s.evidence.map((e) => e.id === id ? { ...e, ...patch } : e) })),
      deleteEvidence: (id) => {
        deletePhoto(id).catch(() => undefined);
        update((s) => ({ ...s, evidence: s.evidence.filter((e) => e.id !== id) }));
      },
      replaceAll: (s) => update(() => s),
      resetDemo: () => {
        state.evidence.forEach((e) => deletePhoto(e.id).catch(() => undefined));
        if (CLOUD) {
          fromServer.current = true;
          setState(emptyState());
          try { localStorage.removeItem(KEY); } catch { /* blocked */ }
          return;
        }
        update(() => seedState());
      },
    };
  }, [state, ready, persistError, update]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useStore(): StoreApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStore outside StoreProvider');
  return v;
}

/** Convenience selectors for the active project. */
export function useProjectData(projectId?: string) {
  const { state } = useStore();
  const pid = projectId ?? state.activeProjectId;
  return useMemo(() => {
    const activities = state.activities
      .filter((a) => a.projectId === pid)
      .sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name));
    const reports = state.reports.filter((r) => r.projectId === pid).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    const boq = state.boq.filter((b) => b.projectId === pid).sort((a, b) => a.item.localeCompare(b.item, undefined, { numeric: true }));
    const evidence = state.evidence.filter((e) => e.projectId === pid).sort((a, b) => b.takenAt.localeCompare(a.takenAt));
    const stops = (state.stops ?? []).filter((s) => s.projectId === pid).sort((a, b) => a.stoppedAt.localeCompare(b.stoppedAt));
    return { pid, activities, reports, boq, evidence, stops };
  }, [state, pid]);
}

export function useBoqTotals(projectId?: string) {
  const { costSettingsFor } = useStore();
  const { pid, boq } = useProjectData(projectId);
  return useMemo(() => boqTotals(boq, costSettingsFor(pid)), [boq, pid, costSettingsFor]);
}
