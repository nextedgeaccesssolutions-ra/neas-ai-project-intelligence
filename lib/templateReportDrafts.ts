// Template reports on this device: a copy of the templates and reports for offline use, and saves made
// while offline. Pending saves go to the server when the connection returns. A save never overwrites a
// newer server copy: if someone changed the report meanwhile, the device copy is kept as a conflict.
import type { SupabaseClient } from '@supabase/supabase-js';

const CACHE = (pid: string) => `neas-tr-cache:${pid}`;
const PENDING = 'neas-tr-pending';

export interface PendingSave {
  id: string; project_id: string; template_id: string | null; title: string; definition: unknown; data: unknown;
  /** server updated_at this edit started from; null = not on the server yet (insert); '' = replace the server copy */
  base: string | null;
  savedAt: string;
  conflict?: boolean;
  /** last refusal from the server, shown to the person (the save is not retried until they act) */
  error?: string;
}

const read = <T,>(k: string, fallback: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : fallback; } catch { return fallback; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };

export const cacheProject = (pid: string, v: { templates: unknown[]; reports: unknown[] }) => write(CACHE(pid), { ...v, at: new Date().toISOString() });
export const cachedProject = (pid: string) => read<{ templates: unknown[]; reports: unknown[]; at?: string } | null>(CACHE(pid), null);

export const pendingSaves = () => read<PendingSave[]>(PENDING, []);
export const pendingFor = (pid: string) => pendingSaves().filter((p) => p.project_id === pid);
/** Keep a save on this device (replaces an earlier pending save of the same report). False when the device has no room. */
export function keepOnDevice(p: PendingSave): boolean {
  return write(PENDING, [...pendingSaves().filter((x) => x.id !== p.id), p]);
}
export const dropPending = (id: string) => write(PENDING, pendingSaves().filter((x) => x.id !== id));

const network = (m: string) => /fetch|network|load failed|timeout/i.test(m);

/** Send pending saves. Network failures are retried later; refusals and conflicts wait for the person. */
export async function flushPending(sb: SupabaseClient): Promise<{ sent: number; conflicts: number; refused: number }> {
  let sent = 0, conflicts = 0, refused = 0;
  for (const p of pendingSaves()) {
    if (p.conflict) { conflicts++; continue; }
    if (p.error) { refused++; continue; }
    if (p.base === null) {
      const { error } = await sb.from('template_reports').insert({ id: p.id, project_id: p.project_id, template_id: p.template_id, title: p.title, definition: p.definition, data: p.data });
      if (!error) { dropPending(p.id); sent++; }
      // already on the server (an earlier send whose reply was lost, or someone else's copy): let the person choose
      else if (error.code === '23505') { keepOnDevice({ ...p, conflict: true }); conflicts++; }
      else if (!network(error.message)) { keepOnDevice({ ...p, error: error.message }); refused++; }
      continue;
    }
    const q = sb.from('template_reports').update({ title: p.title, data: p.data }).eq('id', p.id);
    const { data, error } = await (p.base ? q.eq('updated_at', p.base) : q).select('id');
    if (error) { if (!network(error.message)) { keepOnDevice({ ...p, error: error.message }); refused++; } continue; }
    if (data && data.length) { dropPending(p.id); sent++; continue; }
    // nothing updated: either someone saved a newer copy, or the report was deleted on the server
    const { data: still } = await sb.from('template_reports').select('id').eq('id', p.id).maybeSingle();
    if (still) { keepOnDevice({ ...p, conflict: true }); conflicts++; }
    else { keepOnDevice({ ...p, base: null, error: 'This report was deleted on the server. Send it again to recreate it, or discard the device copy.' }); refused++; }
  }
  return { sent, conflicts, refused };
}

/** Current server timestamp of a report, used as the starting point for the next save. */
export async function serverStamp(sb: SupabaseClient, id: string): Promise<string | null> {
  const { data } = await sb.from('template_reports').select('updated_at').eq('id', id).maybeSingle();
  return (data as { updated_at?: string } | null)?.updated_at ?? null;
}
