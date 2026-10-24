// Ask the browser to keep this site's storage (IndexedDB queue, offline photos) instead of clearing
// it under storage pressure or after a period without use (Safari can clear it after about 7 days).
export type PersistState = 'persisted' | 'not_persisted' | 'unsupported';

export async function requestPersistentStorage(): Promise<PersistState> {
  const s = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  if (!s?.persist || !s.persisted) return 'unsupported';
  try {
    if (await s.persisted()) return 'persisted';
    return (await s.persist()) ? 'persisted' : 'not_persisted';
  } catch {
    return 'unsupported';
  }
}

/** Number of changes on this device that have not reached the server, as one sentence (or null). */
export function unsentSummary(s: { pending: number; conflicts: number; rejected: number }): string | null {
  const n = s.pending + s.conflicts + s.rejected;
  if (!n) return null;
  const parts = [s.pending && `${s.pending} waiting to sync`, s.conflicts && `${s.conflicts} conflict(s)`, s.rejected && `${s.rejected} refused`].filter(Boolean);
  return `${n} change(s) on this device have not reached the server (${parts.join(', ')}).`;
}
