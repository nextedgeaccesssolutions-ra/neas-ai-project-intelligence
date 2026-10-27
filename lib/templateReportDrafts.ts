// Template reports on this device: a copy of the templates and reports for offline use, and saves made
// while offline. Pending saves go to the server when the connection returns. A save never overwrites a
// newer server copy: if someone changed the report meanwhile, the device copy is kept as a conflict.
import type { SupabaseClient } from '@supabase/supabase-js';

const CACHE = (pid: string) => `neas-tr-cache:${pid}`;
const PENDING = 'neas-tr-pending';

export interface PendingSave {
  id: string; project_id: string; template_id: string | null; title: string; definition: unknown; data: unknown;
  /** server updated_at this edit started from; null for a report started offline */
  base: string | null;
  savedAt: string;
  conflict?: boolean;
}

const read = <T,>(k: string, fallback: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : fallback; } catch { return fallback; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };

export const cacheProject = (pid: string, v: { templates: unknown[]; reports: unknown[] }) => write(CACHE(pid), { ...v, at: new Date().toISOString() });
export const cachedProject = (pid: string) => read<{ templates: unknown[]; reports: unknown[]; at?: string } | null>(CACHE(pid), null);

export const pendingSaves = () => read<PendingSave[]>(PENDING, []);
export const pendingFor = (pid: string) => pendingSaves().filter((p) => p.project_id === pid);
/** Keep a save on this device (replaces an earlier pending save of the same report). */
export function keepOnDevice(p: PendingSave): boolean {
  return write(PENDING, [...pendingSaves().filter((x) => x.id !== p.id), p]);
}
export const dropPending = (id: string) => write(PENDING, pendingSaves().filter((x) => x.id !== id));

/** Send pending saves. Returns how many reached the server and how many conflict with a newer copy. */
export async function flushPending(sb: SupabaseClient): Promise<{ sent: number; conflicts: number }> {
  let sent = 0, conflicts = 0;
  for (const p of pendingSaves()) {
    if (p.conflict) { conflicts++; continue; }
    if (p.base === null) {
      const { error } = await sb.from('template_reports').insert({ id: p.id, project_id: p.project_id, template_id: p.template_id, title: p.title, definition: p.definition, data: p.data });
      // already there (sent before the device lost the reply): fall through to an update next time
      if (!error) { dropPending(p.id); sent++; }
      else if (error.code === '23505') keepOnDevice({ ...p, base: '' });
      continue;
    }
    const q = sb.from('template_reports').update({ title: p.title, data: p.data }).eq('id', p.id);
    const { data, error } = await (p.base ? q.eq('updated_at', p.base) : q).select('id');
    if (error) continue; // still offline or refused: try again later
    if (data && data.length) { dropPending(p.id); sent++; }
    else { keepOnDevice({ ...p, conflict: true }); conflicts++; }
  }
  return { sent, conflicts };
}
