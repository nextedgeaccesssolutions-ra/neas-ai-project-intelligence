// Offline outbox: every local change becomes an operation with an idempotency key (op_id),
// stored in IndexedDB until the server confirms it. Survives refresh, closing the app and
// device restarts. Nothing is dropped silently: conflicts and rejections stay until a person
// resolves them.

export type Entity = 'activities' | 'project_reports' | 'report_attachments' | 'boq_lines' | 'cost_settings' | 'quotations';
export type OpStatus = 'pending' | 'syncing' | 'conflict' | 'rejected';

export interface Operation {
  op_id: string;
  entity: Entity;
  op: 'upsert' | 'delete';
  record_id: string;
  project_id: string;
  base_version: number | null;
  payload: Record<string, unknown>;
  status: OpStatus;
  attempts: number;
  next_attempt_at: number;
  error: string | null;
  server_record: Record<string, unknown> | null;
  /** photo or document waiting to be uploaded before the row is written */
  blob_key?: string;
  created_at: string;
  updated_at: string;
  user_id: string;
  /** strictly increasing creation order (timestamps can tie) */
  seq: number;
}

export interface ApplyResult {
  status: 'applied' | 'conflict' | 'rejected';
  record?: Record<string, unknown> | null;
  server_record?: Record<string, unknown>;
  error?: string;
  duplicate?: boolean;
}

/** Server call. Throw for network/5xx problems (they are retried); return a result otherwise. */
export type Transport = (op: Operation) => Promise<ApplyResult>;
export type Uploader = (op: Operation) => Promise<void>;

const DB_NAME = 'neas-offline';
const STORE = 'outbox';
const ORDER: Record<Entity, number> = { activities: 0, boq_lines: 1, cost_settings: 1, quotations: 2, project_reports: 3, report_attachments: 4 };
export const MAX_BACKOFF_MS = 5 * 60 * 1000;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: 'op_id' });
        s.createIndex('record', ['entity', 'record_id']);
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void, store = STORE): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const r = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(r ? (r.result as T) : (undefined as T));
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const allOps = () => run<Operation[]>('readonly', (s) => s.getAll());
const putOp = (op: Operation) => run<IDBValidKey>('readwrite', (s) => s.put(op));
const deleteOp = (id: string) => run<undefined>('readwrite', (s) => s.delete(id));
const getOp = (id: string) => run<Operation | undefined>('readonly', (s) => s.get(id));

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return run<T>('readonly', (s) => s.get(key), 'meta');
}
export async function setMeta(key: string, value: unknown): Promise<void> {
  await run('readwrite', (s) => s.put(value, key), 'meta');
}

export const uuid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });

/** Exponential backoff with jitter: 2s, 4s, 8s … capped at 5 minutes. */
export function backoff(attempts: number, rand = Math.random()): number {
  const base = Math.min(MAX_BACKOFF_MS, 2000 * 2 ** Math.max(0, attempts - 1));
  return Math.round(base * (0.8 + rand * 0.4));
}

const subs = new Set<() => void>();
export const onOutboxChange = (f: () => void) => {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
};
const emit = () => subs.forEach((f) => f());

/**
 * Queue a change. A not-yet-attempted pending op for the same record is merged into (so a
 * hundred edits offline send one update), keeping its op_id and base version.
 */
let lastSeq = 0;
const nextSeq = () => (lastSeq = Math.max(lastSeq + 1, Date.now() * 1000));

export async function enqueue(input: Omit<Operation, 'op_id' | 'status' | 'attempts' | 'next_attempt_at' | 'error' | 'server_record' | 'created_at' | 'updated_at' | 'seq'>): Promise<Operation> {
  const now = new Date().toISOString();
  const ops = await allOps();
  const same = ops
    .filter((o) => o.entity === input.entity && o.record_id === input.record_id && o.status === 'pending' && o.attempts === 0)
    .sort((a, b) => a.seq - b.seq)
    .pop();
  if (same) {
    const merged: Operation = {
      ...same,
      op: input.op,
      payload: input.op === 'delete' ? {} : { ...same.payload, ...input.payload },
      blob_key: input.blob_key ?? same.blob_key,
      updated_at: now,
    };
    await putOp(merged);
    emit();
    return merged;
  }
  const op: Operation = { ...input, op_id: uuid(), status: 'pending', attempts: 0, next_attempt_at: 0, error: null, server_record: null, created_at: now, updated_at: now, seq: nextSeq() };
  await putOp(op);
  emit();
  return op;
}

export interface ProcessReport {
  applied: Operation[];
  results: Map<string, ApplyResult>;
  conflicts: number;
  rejected: number;
  waiting: number;
  networkError: boolean;
}

let running: Promise<ProcessReport> | null = null;

/**
 * Send due operations in dependency order (schedule before reports before photos, oldest first).
 * Stops at the first network failure; backoff spaces out the retries.
 */
export function processOutbox(send: Transport, upload?: Uploader, now = Date.now()): Promise<ProcessReport> {
  if (running) return running;
  running = (async () => {
    const report: ProcessReport = { applied: [], results: new Map(), conflicts: 0, rejected: 0, waiting: 0, networkError: false };
    const ops = (await allOps())
      .filter((o) => o.status === 'pending' || o.status === 'syncing')
      .sort((a, b) => ORDER[a.entity] - ORDER[b.entity] || a.seq - b.seq);
    const blockedRecords = new Set<string>();
    for (const queued of ops) {
      const op = await getOp(queued.op_id); // re-read: an earlier op may have rebased it
      if (!op || (op.status !== 'pending' && op.status !== 'syncing')) continue;
      const recKey = `${op.entity}:${op.record_id}`;
      if (op.next_attempt_at > now || blockedRecords.has(recKey)) {
        report.waiting++;
        blockedRecords.add(recKey);
        continue;
      }
      const inFlight: Operation = { ...op, status: 'syncing', attempts: op.attempts + 1, updated_at: new Date().toISOString() };
      await putOp(inFlight);
      emit();
      let res: ApplyResult;
      try {
        if (op.blob_key && upload) await upload(inFlight);
        res = await send(inFlight);
      } catch (e) {
        await putOp({ ...inFlight, status: 'pending', next_attempt_at: Date.now() + backoff(inFlight.attempts), error: (e as Error)?.message ?? 'Network error' });
        report.networkError = true;
        report.waiting++;
        emit();
        break;
      }
      report.results.set(op.op_id, res);
      if (res.status === 'applied') {
        await deleteOp(op.op_id);
        report.applied.push(inFlight);
        // later edits of the same record were based on the old version: move them forward
        const newVersion = Number((res.record as { version?: number } | null)?.version);
        if (Number.isFinite(newVersion)) {
          for (const later of (await allOps()).filter((o) => o.entity === op.entity && o.record_id === op.record_id && o.op_id !== op.op_id)) {
            if (later.base_version === op.base_version || later.base_version === null) await putOp({ ...later, base_version: newVersion });
          }
        }
      } else if (res.status === 'conflict') {
        await putOp({ ...inFlight, status: 'conflict', server_record: res.server_record ?? null, error: 'Someone changed this record before your update arrived.' });
        report.conflicts++;
        blockedRecords.add(recKey);
      } else {
        await putOp({ ...inFlight, status: 'rejected', error: res.error ?? 'The server refused this change.' });
        report.rejected++;
        blockedRecords.add(recKey);
      }
      emit();
    }
    return report;
  })().finally(() => {
    running = null;
  });
  return running;
}

/** Conflict: keep my version (re-send on top of the server's) or take the server's. */
export async function resolveConflict(opId: string, choice: 'mine' | 'server'): Promise<Operation | null> {
  const op = (await allOps()).find((o) => o.op_id === opId);
  if (!op || op.status !== 'conflict') return null;
  if (choice === 'server') {
    await deleteOp(opId);
    emit();
    return op;
  }
  const v = Number((op.server_record as { version?: number } | null)?.version);
  // a fresh op_id: the old one is recorded on the server as a conflict and would be replayed
  const fresh: Operation = { ...op, op_id: uuid(), status: 'pending', attempts: 0, next_attempt_at: 0, error: null, base_version: Number.isFinite(v) ? v : op.base_version, server_record: null, updated_at: new Date().toISOString() };
  await deleteOp(opId);
  await putOp(fresh);
  emit();
  return fresh;
}

/** Retry a rejected or waiting op now (e.g. after an administrator restored access). */
/** A record changed on the server outside the outbox (e.g. a direct "show to client" update): queued edits based on the old version move to the new one. */
export async function rebaseOps(entity: Entity, recordId: string, from: number | null, to: number): Promise<void> {
  for (const o of await allOps()) {
    if (o.entity === entity && o.record_id === recordId && (o.status === 'pending' || o.status === 'syncing') && (o.base_version === from || o.base_version === null)) await putOp({ ...o, base_version: to });
  }
}

export async function retryOp(opId: string): Promise<void> {
  const op = (await allOps()).find((o) => o.op_id === opId);
  if (!op) return;
  await putOp({ ...op, op_id: op.status === 'rejected' ? uuid() : op.op_id, status: 'pending', next_attempt_at: 0, error: null });
  if (op.status === 'rejected') await deleteOp(opId);
  emit();
}

/** Only on an explicit, confirmed user action. */
export async function discardOp(opId: string): Promise<void> {
  await deleteOp(opId);
  emit();
}

export async function counts(): Promise<Record<OpStatus, number>> {
  const c: Record<OpStatus, number> = { pending: 0, syncing: 0, conflict: 0, rejected: 0 };
  for (const o of await allOps()) c[o.status]++;
  return c;
}
