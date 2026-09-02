import type { AtlasBeaconSnapshot, AtlasDistrictId } from '../../shared/atlas/types';
import type { AtlasEchoDescriptor } from './echoes';

const BEACON_DISTRICTS: AtlasDistrictId[] = ['genesis-garden', 'light-forest', 'pay-harbor', 'albatross-causeway', 'validator-peaks', 'builder-city'];
const DEFAULT_TARGET = 100;
const STALE_AFTER_MS = 5 * 60_000;

export interface AtlasBeaconContribution {
  date: string;
  districtId: AtlasDistrictId;
  actorId: string;
  walletAddress: string;
  runId: string;
  score: number;
  repairUnits: number;
  verified: boolean;
  prizeEligible: boolean;
}

export interface AtlasBeaconMonument {
  seasonId: string;
  monumentId: string;
}

export interface AtlasBeaconProjection extends AtlasBeaconSnapshot {
  monuments: AtlasBeaconMonument[];
  echoes: AtlasEchoDescriptor[];
}

export interface AtlasBeaconRead extends AtlasBeaconProjection {
  status: 'live' | 'stale' | 'unavailable';
  snapshot: AtlasBeaconProjection | null;
}

interface BeaconRepositoryState {
  version: 1;
  projection: AtlasBeaconProjection;
  contributions: Record<string, AtlasBeaconContribution>;
}

export interface AtlasBeaconRepository {
  failReads: boolean;
  load(): Promise<BeaconRepositoryState>;
  save(state: BeaconRepositoryState): Promise<void>;
}

export interface AtlasBeaconService {
  apply(input: AtlasBeaconContribution): Promise<AtlasBeaconProjection>;
  preserveMonument(input: AtlasBeaconMonument): Promise<AtlasBeaconProjection>;
  appendEcho(input: AtlasEchoDescriptor): Promise<AtlasBeaconProjection>;
  read(): Promise<AtlasBeaconRead>;
}

export function createAtlasBeaconRepository(): AtlasBeaconRepository {
  let state = createState();
  const repository: AtlasBeaconRepository = {
    failReads: false,
    async load() {
      if (repository.failReads) throw new Error('Atlas Beacon repository unavailable.');
      return structuredClone(state);
    },
    async save(next) {
      state = structuredClone(next);
    },
  };
  return repository;
}

export function createAtlasBeaconService(options: { repository: AtlasBeaconRepository; now?: () => number }): AtlasBeaconService {
  const now = options.now ?? Date.now;
  let operations: Promise<void> = Promise.resolve();
  const serialise = (operation: () => Promise<void>): Promise<void> => {
    operations = operations.catch(() => undefined).then(operation);
    return operations;
  };
  const load = async (): Promise<BeaconRepositoryState> => {
    const state = await options.repository.load();
    return state;
  };
  return {
    async apply(input) {
      let result: AtlasBeaconProjection | null = null;
      await serialise(async () => {
        validateContribution(input);
        if (!input.verified || !input.prizeEligible) throw new Error('Atlas Beacon accepts only verified eligible runs.');
        const state = await load();
        const key = `${input.date}:${input.districtId}:${input.actorId}:${input.walletAddress}`;
        const previous = state.contributions[key];
        if (previous && input.score <= previous.score) { result = structuredClone(state.projection); return; }
        const delta = Math.max(0, input.repairUnits - (previous?.repairUnits ?? 0));
        state.contributions[key] = { ...input };
        if (delta > 0) {
          const projection = structuredClone(state.projection);
          const system = projection.systems.find((item) => item.districtId === input.districtId);
          if (!system) throw new Error('Atlas Beacon district system is unknown.');
          system.repairTotal += delta;
          system.stage = Math.min(3, Math.floor(system.repairTotal * 3 / system.target));
          projection.verifiedContributorCount = new Set(Object.values(state.contributions).map((item) => `${item.actorId}:${item.walletAddress}`)).size;
          projection.projectionVersion += 1;
          projection.lastUpdatedAt = now();
          state.projection = projection;
        }
        await options.repository.save(state);
        result = structuredClone(state.projection);
      });
      if (!result) throw new Error('Atlas Beacon projection was not produced.');
      return result;
    },
    async preserveMonument(input) {
      let result: AtlasBeaconProjection | null = null;
      await serialise(async () => {
        if (!/^[a-z0-9-]{1,80}$/.test(input.seasonId) || !/^[a-z0-9-]{1,80}$/.test(input.monumentId)) throw new Error('Atlas Beacon monument is malformed.');
        const state = await load();
        if (!state.projection.monuments.some((monument) => monument.seasonId === input.seasonId && monument.monumentId === input.monumentId)) {
          state.projection.monuments.push({ ...input });
          state.projection.monuments.sort((left, right) => `${left.seasonId}:${left.monumentId}`.localeCompare(`${right.seasonId}:${right.monumentId}`));
          await options.repository.save(state);
        }
        result = structuredClone(state.projection);
      });
      if (!result) throw new Error('Atlas Beacon monument was not produced.');
      return result;
    },
    async appendEcho(input) {
      let result: AtlasBeaconProjection | null = null;
      await serialise(async () => {
        validateEcho(input);
        const state = await load();
        if (!state.projection.echoes.some((echo) => echo.id === input.id)) {
          state.projection.echoes.push(structuredClone(input));
          state.projection.echoes.sort((left, right) => left.id.localeCompare(right.id));
          state.projection.echoes = state.projection.echoes.slice(-100);
          state.projection.projectionVersion += 1;
          state.projection.lastUpdatedAt = now();
          await options.repository.save(state);
        }
        result = structuredClone(state.projection);
      });
      if (!result) throw new Error('Atlas Beacon echo was not produced.');
      return result;
    },
    async read() {
      try {
        const state = await load();
        const projection = structuredClone(state.projection);
        const status = projection.lastUpdatedAt > 0 && now() - projection.lastUpdatedAt > STALE_AFTER_MS ? 'stale' : 'live';
        return { ...projection, status, snapshot: projection };
      } catch {
        return { status: 'unavailable', snapshot: null, version: 1, projectionVersion: 0, systems: [], verifiedContributorCount: 0, lastUpdatedAt: 0, monuments: [], echoes: [] };
      }
    },
  };
}

function createState(): BeaconRepositoryState {
  return {
    version: 1,
    projection: { version: 1, projectionVersion: 0, systems: BEACON_DISTRICTS.map((districtId) => ({ districtId, repairTotal: 0, target: DEFAULT_TARGET, stage: 0 })), verifiedContributorCount: 0, lastUpdatedAt: 0, monuments: [], echoes: [] },
    contributions: {},
  };
}

function validateContribution(input: AtlasBeaconContribution): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !input.actorId || !input.walletAddress || !input.runId || !Number.isSafeInteger(input.score) || input.score < 0 || !Number.isSafeInteger(input.repairUnits) || input.repairUnits < 0) throw new Error('Atlas Beacon contribution is malformed.');
}

function validateEcho(input: AtlasEchoDescriptor): void {
  if (!/^[a-z0-9-]{1,120}$/.test(input.id) || !/^[a-z0-9-]{1,80}$/.test(input.cosmeticId) || !input.displayName || input.displayName.length > 40 || !Number.isSafeInteger(input.contributionDelta) || input.contributionDelta < 0 || !Number.isSafeInteger(input.observedAtBucket) || input.observedAtBucket < 0) throw new Error('Atlas Beacon echo is malformed.');
}
