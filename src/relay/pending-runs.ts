export interface PendingRelayRun { runId: string; payload: string; createdAt: number; }
export interface PendingRunStore { put(run: PendingRelayRun): Promise<void>; get(runId: string): Promise<PendingRelayRun | null>; delete(runId: string): Promise<void>; }

export class PendingRunError extends Error { readonly code = 'pending_run_conflict' as const; }

export function createPendingRunStore(options: { databaseName?: string; storeName?: string } = {}): PendingRunStore {
  const values = new Map<string, PendingRelayRun>();
  if (typeof indexedDB === 'undefined') {
    return {
      async put(run) { const existing = values.get(run.runId); if (existing && existing.payload !== run.payload) throw new PendingRunError('Different bytes already exist for this run id.'); if (!existing) values.set(run.runId, { ...run }); },
      async get(runId) { const value = values.get(runId); return value ? { ...value } : null; },
      async delete(runId) { values.delete(runId); },
    };
  }

  const databaseName = options.databaseName ?? 'sface-relay';
  const storeName = options.storeName ?? 'pending-runs';
  let databasePromise: Promise<IDBDatabase> | null = null;
  const database = (): Promise<IDBDatabase> => {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => { request.result.createObjectStore(storeName, { keyPath: 'runId' }); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB could not be opened.'));
    });
    return databasePromise;
  };
  const read = async (runId: string): Promise<PendingRelayRun | null> => {
    const db = await database();
    return new Promise((resolve, reject) => {
      const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(runId);
      request.onsuccess = () => resolve(request.result ? { ...request.result as PendingRelayRun } : null);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB read failed.'));
    });
  };
  const write = async (run: PendingRelayRun): Promise<void> => {
    const db = await database();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      const request = transaction.objectStore(storeName).get(run.runId);
      request.onsuccess = () => {
        const existing = request.result as PendingRelayRun | undefined;
        if (existing && existing.payload !== run.payload) {
          transaction.abort();
          reject(new PendingRunError('Different bytes already exist for this run id.'));
          return;
        }
        if (!existing) transaction.objectStore(storeName).add(run);
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB write failed.'));
      transaction.onabort = () => { if (!request.result || (request.result as PendingRelayRun).payload === run.payload) reject(transaction.error ?? new Error('IndexedDB write aborted.')); };
    });
  };
  const remove = async (runId: string): Promise<void> => {
    const db = await database();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).delete(runId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB delete failed.'));
    });
  };
  return {
    put: write,
    get: read,
    delete: remove,
  };
}

export async function submitPendingRun<T>(input: { store: PendingRunStore; runId: string; payload: string; createdAt: number; query: (runId: string) => Promise<T | null>; send: (payload: string) => Promise<T> }): Promise<T> {
  await input.store.put({ runId: input.runId, payload: input.payload, createdAt: input.createdAt });
  const existing = await input.query(input.runId);
  if (existing) return existing;
  try {
    const result = await input.send(input.payload);
    await input.store.delete(input.runId);
    return result;
  } catch (error) {
    const reconciled = await input.query(input.runId);
    if (reconciled) return reconciled;
    throw error;
  }
}
