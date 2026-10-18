import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { allOps, backoff, discardOp, enqueue, processOutbox, resolveConflict, retryOp, type ApplyResult, type Operation } from '../lib/offline/outbox';

// A stand-in for neas.apply_operation with the same rules: op_id ledger, version check.
function fakeServer() {
  const rows = new Map<string, { id: string; version: number; [k: string]: unknown }>();
  const ledger = new Map<string, ApplyResult>();
  const apply = (op: Operation): ApplyResult => {
    const prior = ledger.get(op.op_id);
    if (prior) return { ...prior, duplicate: true };
    const cur = rows.get(op.record_id);
    let res: ApplyResult;
    if (!cur) {
      const rec = { id: op.record_id, version: 1, ...op.payload };
      rows.set(op.record_id, rec);
      res = { status: 'applied', record: rec };
    } else if (op.base_version !== cur.version) {
      res = { status: 'conflict', server_record: cur };
    } else {
      const rec = { ...cur, ...op.payload, version: cur.version + 1 };
      rows.set(op.record_id, rec);
      res = { status: 'applied', record: rec };
    }
    ledger.set(op.op_id, res);
    return res;
  };
  return { rows, ledger, apply };
}

const base = { entity: 'project_reports' as const, op: 'upsert' as const, project_id: 'p1', user_id: 'u1' };

beforeEach(async () => {
  for (const o of await allOps()) await discardOp(o.op_id);
});

describe('offline outbox', () => {
  it('keeps queued work until it is sent, then removes it', async () => {
    const srv = fakeServer();
    await enqueue({ ...base, record_id: 'r1', base_version: null, payload: { actual_pct: 10 } });
    expect(await allOps()).toHaveLength(1);
    const rep = await processOutbox(async (op) => srv.apply(op));
    expect(rep.applied).toHaveLength(1);
    expect(await allOps()).toHaveLength(0);
    expect(srv.rows.get('r1')?.actual_pct).toBe(10);
  });

  it('merges repeated offline edits of one record into one operation', async () => {
    await enqueue({ ...base, record_id: 'r2', base_version: null, payload: { actual_pct: 10 } });
    await enqueue({ ...base, record_id: 'r2', base_version: null, payload: { actual_pct: 20 } });
    await enqueue({ ...base, record_id: 'r2', base_version: null, payload: { notes: 'x' } });
    const ops = await allOps();
    expect(ops).toHaveLength(1);
    expect(ops[0].payload).toEqual({ actual_pct: 20, notes: 'x' });
  });

  it('a lost response is retried with the same op_id and never duplicates the record', async () => {
    const srv = fakeServer();
    await enqueue({ ...base, record_id: 'r3', base_version: null, payload: { actual_pct: 30 } });
    // server applies, but the reply is lost on the way back
    const r1 = await processOutbox(async (op) => {
      srv.apply(op);
      throw new Error('Failed to fetch');
    });
    expect(r1.networkError).toBe(true);
    const [waiting] = await allOps();
    expect(waiting.status).toBe('pending');
    expect(waiting.attempts).toBe(1);
    expect(waiting.next_attempt_at).toBeGreaterThan(Date.now());
    // too early: backoff holds it
    const r2 = await processOutbox(async (op) => srv.apply(op));
    expect(r2.waiting).toBe(1);
    // later: retried with the same op_id; the server answers from its ledger
    let sawDuplicate = false;
    await processOutbox(async (op) => {
      const res = srv.apply(op);
      sawDuplicate = !!res.duplicate;
      return res;
    }, undefined, Date.now() + 10 * 60 * 1000);
    expect(sawDuplicate).toBe(true);
    expect(srv.rows.size).toBe(1);
    expect(await allOps()).toHaveLength(0);
  });

  it('rebases a later edit on the version the server just created', async () => {
    const srv = fakeServer();
    await enqueue({ ...base, record_id: 'r4', base_version: null, payload: { actual_pct: 5 } });
    await processOutbox(async () => { throw new Error('offline'); });
    await enqueue({ ...base, record_id: 'r4', base_version: null, payload: { actual_pct: 50 } }); // separate op: first was attempted
    expect(await allOps()).toHaveLength(2);
    await processOutbox(async (op) => srv.apply(op), undefined, Date.now() + 10 * 60 * 1000);
    expect(await allOps()).toHaveLength(0);
    expect(srv.rows.get('r4')).toMatchObject({ actual_pct: 50, version: 2 });
  });

  it('a conflicting edit is held for review, then resolved either way', async () => {
    const srv = fakeServer();
    srv.rows.set('r5', { id: 'r5', version: 3, actual_pct: 70 });
    await enqueue({ ...base, record_id: 'r5', base_version: 2, payload: { actual_pct: 40 } });
    const rep = await processOutbox(async (op) => srv.apply(op));
    expect(rep.conflicts).toBe(1);
    const [held] = await allOps();
    expect(held.status).toBe('conflict');
    expect(held.server_record).toMatchObject({ version: 3 });
    expect(srv.rows.get('r5')?.actual_pct).toBe(70); // server value not overwritten
    const mine = await resolveConflict(held.op_id, 'mine');
    expect(mine?.base_version).toBe(3);
    await processOutbox(async (op) => srv.apply(op));
    expect(srv.rows.get('r5')).toMatchObject({ actual_pct: 40, version: 4 });
  });

  it('rejected changes are never dropped silently and can be retried', async () => {
    await enqueue({ ...base, record_id: 'r6', base_version: null, payload: { actual_pct: 1 } });
    const rep = await processOutbox(async () => ({ status: 'rejected', error: 'Your account is not active' }));
    expect(rep.rejected).toBe(1);
    const [kept] = await allOps();
    expect(kept.status).toBe('rejected');
    expect(kept.error).toMatch(/not active/);
    await retryOp(kept.op_id);
    const [again] = await allOps();
    expect(again.status).toBe('pending');
    expect(again.op_id).not.toBe(kept.op_id);
  });

  it('sends the schedule before reports that depend on it', async () => {
    const order: string[] = [];
    await enqueue({ ...base, entity: 'project_reports', record_id: 'rep', base_version: null, payload: {} });
    await enqueue({ ...base, entity: 'activities', record_id: 'act', base_version: null, payload: {} });
    await processOutbox(async (op) => (order.push(op.entity), { status: 'applied', record: { version: 1 } }));
    expect(order).toEqual(['activities', 'project_reports']);
  });

  it('backoff grows exponentially and is capped', () => {
    expect(backoff(1, 0.5)).toBe(2000);
    expect(backoff(3, 0.5)).toBe(8000);
    expect(backoff(30, 0.5)).toBe(300000);
  });
});
