import type { RelaySnapshot, RelayStore } from './store';

export const RELAY_ACTOR_DAILY_REPAIR_CAP = 100;

export interface RelayWorldProjection {
  missionDate: string;
  target: number;
  unlockThresholds: number[];
  repairTotal: number;
  verifiedPlayerCount: number;
  projectionVersion: number;
  lastUpdatedAt: number;
  actors: Record<string, { bestRepairUnits: number; contribution: number }>;
}

export interface RelayWorldService {
  apply(input: { missionDate: string; actorId: string; repairUnits: number; target: number; unlockThresholds?: number[]; now?: number }): Promise<RelayWorldProjection>;
  get(missionDate: string): Promise<RelayWorldProjection | null>;
}

export function createRelayWorldService(options: { store: RelayStore; now?: () => number }): RelayWorldService {
  const now = options.now ?? (() => Date.now());
  let snapshot: RelaySnapshot | null = null;
  let operations: Promise<void> = Promise.resolve();
  const ensure = async (): Promise<RelaySnapshot> => { if (!snapshot) snapshot = await options.store.load(); return snapshot; };
  const serialise = (operation: () => Promise<void>): Promise<void> => { operations = operations.catch(() => undefined).then(operation); return operations; };
  const read = (current: RelaySnapshot, date: string): RelayWorldProjection | null => {
    const value = current.worldProjections[date] as unknown as RelayWorldProjection | undefined;
    return value ? structuredClone(value) : null;
  };

  return {
    async apply(input) {
      let result: RelayWorldProjection | null = null;
      await serialise(async () => {
        if (!Number.isSafeInteger(input.repairUnits) || input.repairUnits < 0) throw new Error('relay_world_invalid_repair');
        if (!Number.isSafeInteger(input.target) || input.target <= 0) throw new Error('relay_world_invalid_target');
        const current = await ensure();
        const existing = read(current, input.missionDate);
        const projection = existing ?? {
          missionDate: input.missionDate,
          target: input.target,
          unlockThresholds: [...(input.unlockThresholds ?? [])],
          repairTotal: 0,
          verifiedPlayerCount: 0,
          projectionVersion: 0,
          lastUpdatedAt: input.now ?? now(),
          actors: {},
        } satisfies RelayWorldProjection;
        const actor = projection.actors[input.actorId];
        const boundedBest = Math.min(RELAY_ACTOR_DAILY_REPAIR_CAP, input.repairUnits);
        const previousContribution = actor?.contribution ?? 0;
        const contribution = Math.max(previousContribution, boundedBest);
        const delta = contribution - previousContribution;
        const isNewActor = !actor;
        if (delta <= 0 && !isNewActor) { result = structuredClone(projection); return; }
        const next = structuredClone(projection);
        next.actors[input.actorId] = { bestRepairUnits: Math.max(actor?.bestRepairUnits ?? 0, input.repairUnits), contribution };
        next.repairTotal += delta;
        if (isNewActor) next.verifiedPlayerCount += 1;
        next.projectionVersion += 1;
        next.lastUpdatedAt = input.now ?? now();
        const nextSnapshot = structuredClone(current);
        nextSnapshot.worldProjections[input.missionDate] = next as unknown as Record<string, unknown>;
        await options.store.commit('world.projected', nextSnapshot);
        snapshot = nextSnapshot;
        result = next;
      });
      return result ?? (() => { throw new Error('Relay world projection was not produced.'); })();
    },
    async get(missionDate) {
      return read(await ensure(), missionDate);
    },
  };
}
