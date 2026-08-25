import { describe, expect, it } from 'vitest';

import { createPendingRunStore, submitPendingRun } from '../src/relay/pending-runs';
import { normalizeRelayTransactionResult } from '../src/relay/nimiq/transaction-result';

describe('Relay pending competitive runs', () => {
  it('stores exact payload bytes idempotently and refuses replacement under one run id', async () => {
    const store = createPendingRunStore();
    await store.put({ runId: 'run-1', payload: '{"score":100}', createdAt: 1 });
    await expect(store.put({ runId: 'run-1', payload: '{"score":100}', createdAt: 2 })).resolves.toBeUndefined();
    await expect(store.put({ runId: 'run-1', payload: '{"score":999}', createdAt: 3 })).rejects.toMatchObject({ code: 'pending_run_conflict' });
  });

  it('queries by run id before retrying and reconciles a timeout without resending', async () => {
    const store = createPendingRunStore();
    let sends = 0;
    const result = await submitPendingRun({
      store,
      runId: 'run-2',
      payload: '{"score":120}',
      createdAt: 1,
      query: async () => ({ runId: 'run-2', status: 'verified' }),
      send: async () => { sends += 1; throw new Error('timeout'); },
    });
    expect(result).toEqual({ runId: 'run-2', status: 'verified' });
    expect(sends).toBe(0);
  });

  it('normalizes SDK transaction replies without treating any reply as proof', () => {
    expect(normalizeRelayTransactionResult('serialized-or-hash')).toEqual({ kind: 'ambiguous', value: 'serialized-or-hash' });
    expect(normalizeRelayTransactionResult({ error: { type: 'denied', message: 'no' } })).toEqual({ kind: 'error', type: 'denied', message: 'no' });
    expect(normalizeRelayTransactionResult(null)).toEqual({ kind: 'empty' });
  });
});
