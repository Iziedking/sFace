import { createHash } from 'node:crypto';
import {
  createAtlasUsageState,
  foldAtlasUsage,
  summariseAtlasUsage,
  type AtlasUsageState,
  type AtlasUsageSummary,
} from '../../shared/atlas/usage';
import type { AtlasStateStore } from './persistence';

const PERSISTENCE_KEY = 'atlas-usage';

export interface AtlasUsageService {
  record(input: { name: string; session: string; chapter?: number; device?: string }): Promise<void>;
  summary(): Promise<AtlasUsageSummary>;
}

/**
 * Counts anonymous participation so we can state a real usage number.
 *
 * Two decisions worth keeping:
 *
 * **The raw session id never reaches disk.** The client sends an opaque random
 * id to tie its own events together; we store `sha256(id + salt)` truncated.
 * That is enough to count distinct and returning players and not enough to
 * work backwards to anyone. The salt is per deployment, so the same id on two
 * deployments does not correlate.
 *
 * **Writes are serialised and the ledger is hydrated before the first one**,
 * for the reason recorded at length in payouts.ts: setting a hydrated flag
 * before the load resolves means one transient read error silently persists an
 * empty state over the real one. Losing a usage count is not losing money, but
 * the failure is identical and the fix is cheap, so it is done the same way.
 */
export function createAtlasUsageService(options: { stateStore?: AtlasStateStore; salt?: string; now?: () => number }): AtlasUsageService {
  const now = options.now ?? Date.now;
  // A deployment-scoped salt. Absent one, hashing is still applied; it just
  // does not defend against correlation across deployments, which is not a
  // property this app needs but is cheap to have.
  const salt = options.salt ?? 'atlas-usage';
  let state: AtlasUsageState = createAtlasUsageState();
  let hydrated = false;
  let operations: Promise<void> = Promise.resolve();

  async function hydrate(): Promise<void> {
    if (hydrated || !options.stateStore) return;
    const loaded = await options.stateStore.load<AtlasUsageState | null>(PERSISTENCE_KEY, null);
    if (loaded && loaded.version === 1 && typeof loaded.sessions === 'object' && loaded.sessions !== null) {
      state = { version: 1, sessions: loaded.sessions, days: loaded.days ?? {}, rejected: loaded.rejected ?? 0 };
    }
    hydrated = true;
  }

  function serialise<T>(operation: () => Promise<T>, persist: boolean): Promise<T> {
    const result = operations.catch(() => undefined).then(async () => {
      await hydrate();
      const before = persist ? state : null;
      try {
        const value = await operation();
        if (persist) await options.stateStore?.save<AtlasUsageState>(PERSISTENCE_KEY, state);
        return value;
      } catch (error) {
        if (before) state = before;
        throw error;
      }
    });
    operations = result.then(() => undefined, () => undefined);
    return result;
  }

  return {
    async record(input) {
      await serialise(async () => {
        const session = createHash('sha256').update(`${salt}:${input.session}`).digest('hex').slice(0, 32);
        state = foldAtlasUsage(state, {
          name: input.name,
          session,
          ...(input.chapter === undefined ? {} : { chapter: input.chapter }),
          ...(input.device === undefined ? {} : { device: input.device }),
          at: now(),
        });
      }, true);
    },
    async summary() {
      return serialise(async () => summariseAtlasUsage(state, now()), false);
    },
  };
}
