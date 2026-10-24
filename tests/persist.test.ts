import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestPersistentStorage, unsentSummary } from '../lib/offline/persist';

const setStorage = (v: unknown) => Object.defineProperty(globalThis, 'navigator', { value: { storage: v }, configurable: true });
afterEach(() => { vi.restoreAllMocks(); });

describe('persistent storage', () => {
  it('reports already persisted storage without asking again', async () => {
    const persist = vi.fn();
    setStorage({ persisted: async () => true, persist });
    expect(await requestPersistentStorage()).toBe('persisted');
    expect(persist).not.toHaveBeenCalled();
  });
  it('asks once and reports a refusal', async () => {
    setStorage({ persisted: async () => false, persist: async () => false });
    expect(await requestPersistentStorage()).toBe('not_persisted');
  });
  it('handles browsers without the API or that throw', async () => {
    setStorage(undefined);
    expect(await requestPersistentStorage()).toBe('unsupported');
    setStorage({ persisted: async () => { throw new Error('blocked'); }, persist: async () => true });
    expect(await requestPersistentStorage()).toBe('unsupported');
  });
});

describe('unsent changes summary', () => {
  it('is empty when everything has synced', () => {
    expect(unsentSummary({ pending: 0, conflicts: 0, rejected: 0 })).toBeNull();
  });
  it('counts every kind of unsent change', () => {
    expect(unsentSummary({ pending: 2, conflicts: 1, rejected: 0 })).toBe('3 change(s) on this device have not reached the server (2 waiting to sync, 1 conflict(s)).');
  });
});
