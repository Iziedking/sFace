import type { AtlasDistrictId } from '../../shared/atlas/types';

const STALE_AFTER_MS = 5 * 60_000;
const MAX_ECHOES = 100;
const ACTIONS = ['scan', 'repair', 'carry', 'install', 'celebrate'] as const;

export type AtlasEchoAction = (typeof ACTIONS)[number];

export interface AtlasEchoInput {
  date: string;
  districtId: AtlasDistrictId;
  actorId: string;
  walletAddress: string;
  runId: string;
  score: number;
  verified: boolean;
  prizeEligible: boolean;
  action: AtlasEchoAction;
  observedAt: number;
  displayName: string;
  displayNameOptIn: boolean;
}

export interface AtlasEchoDescriptor {
  id: string;
  districtId: AtlasDistrictId;
  action: AtlasEchoAction;
  cosmeticId: string;
  displayName: string;
  contributionDelta: number;
  observedAtBucket: number;
}

export interface AtlasEchoRead {
  status: 'live' | 'stale' | 'unavailable';
  echoes: AtlasEchoDescriptor[];
}

interface StoredEcho {
  input: AtlasEchoInput;
  key: string;
}

interface EchoRepositoryState {
  version: 1;
  lastUpdatedAt: number;
  echoes: StoredEcho[];
}

export interface AtlasEchoRepository {
  failReads: boolean;
  load(): Promise<EchoRepositoryState>;
  save(state: EchoRepositoryState): Promise<void>;
}

export interface AtlasEchoService {
  record(input: AtlasEchoInput): Promise<AtlasEchoDescriptor>;
  read(): Promise<AtlasEchoRead>;
}

export function createAtlasEchoRepository(): AtlasEchoRepository {
  let state: EchoRepositoryState = { version: 1, lastUpdatedAt: 0, echoes: [] };
  const repository: AtlasEchoRepository = {
    failReads: false,
    async load() {
      if (repository.failReads) throw new Error('Atlas Echo repository unavailable.');
      return structuredClone(state);
    },
    async save(next) {
      state = structuredClone(next);
    },
  };
  return repository;
}

export function createAtlasEchoService(options: { repository: AtlasEchoRepository; now?: () => number }): AtlasEchoService {
  const now = options.now ?? Date.now;
  let operations: Promise<void> = Promise.resolve();
  const serialise = (operation: () => Promise<void>): Promise<void> => {
    operations = operations.catch(() => undefined).then(operation);
    return operations;
  };

  return {
    async record(input) {
      validateInput(input);
      if (!input.verified) throw new Error('Atlas Echo requires a verified run.');
      if (!input.prizeEligible) throw new Error('Atlas Echo requires an eligible run.');
      const key = `${input.date}:${input.actorId}:${input.walletAddress}`;
      let result: AtlasEchoDescriptor | null = null;
      await serialise(async () => {
        const state = await options.repository.load();
        const current = state.echoes.find((echo) => echo.key === key);
        const candidate = { input: structuredClone(input), key };
        if (!current || input.score > current.input.score || input.score === current.input.score && candidateKey(candidate) < candidateKey(current)) {
          const nextEchoes = state.echoes.filter((echo) => echo.key !== key);
          nextEchoes.push(candidate);
          nextEchoes.sort((left, right) => left.key.localeCompare(right.key));
          await options.repository.save({ version: 1, lastUpdatedAt: now(), echoes: nextEchoes });
          result = toDescriptor(candidate);
        } else {
          result = toDescriptor(current);
        }
      });
      if (!result) throw new Error('Atlas Echo was not produced.');
      return result;
    },
    async read() {
      try {
        const state = await options.repository.load();
        const echoes = state.echoes.map(toDescriptor).sort((left, right) => right.observedAtBucket - left.observedAtBucket || left.id.localeCompare(right.id)).slice(0, MAX_ECHOES);
        const status = state.lastUpdatedAt > 0 && now() - state.lastUpdatedAt > STALE_AFTER_MS ? 'stale' : 'live';
        return { status, echoes };
      } catch {
        return { status: 'unavailable', echoes: [] };
      }
    },
  };
}

function toDescriptor(stored: StoredEcho): AtlasEchoDescriptor {
  const { input } = stored;
  return {
    id: `echo-${hashText(stored.key)}`,
    districtId: input.districtId,
    action: input.action,
    cosmeticId: `${input.districtId}-${input.action}-mark`,
    displayName: input.displayNameOptIn ? input.displayName.trim() : `Explorer #${hashText(stored.key).slice(0, 4)}`,
    contributionDelta: Math.min(1_000, input.score),
    observedAtBucket: Math.floor(input.observedAt / 60_000),
  };
}

function candidateKey(stored: StoredEcho): string {
  return `${stored.input.action}:${stored.input.districtId}:${stored.input.runId}`;
}

function validateInput(input: AtlasEchoInput): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !input.actorId || input.actorId.length > 120 || !input.walletAddress || input.walletAddress.length > 120 || !input.runId || input.runId.length > 120 || !Number.isSafeInteger(input.score) || input.score < 0 || !Number.isSafeInteger(input.observedAt) || input.observedAt < 0 || !ACTIONS.includes(input.action)) throw new Error('Atlas Echo input is malformed.');
  if (typeof input.displayName !== 'string' || typeof input.displayNameOptIn !== 'boolean') throw new Error('Atlas Echo name is malformed.');
  if (input.displayNameOptIn && !/^[A-Za-z0-9][A-Za-z0-9 _-]{0,31}$/.test(input.displayName.trim())) throw new Error('Atlas Echo name is malformed.');
}

function hashText(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
