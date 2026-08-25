import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { RelayRunRecord } from '../../shared/relay/types';
import { appendRelayEvent, readRelayEvents, type RelayTransitionEvent } from './events';

export type { RelayRunRecord } from '../../shared/relay/types';

export const RELAY_SNAPSHOT_VERSION = 1 as const;

export interface RelayPayoutRecord {
  id: string;
  period: string;
  walletAddress: string;
  amountLuna: number;
  transactionHash: string | null;
  status: 'pending' | 'draft' | 'approved' | 'submitted' | 'confirming' | 'unknown' | 'verified' | 'failed' | 'rejected';
  refusalReason?: string | null;
  network?: 'main' | 'test';
  treasuryAddress?: string;
  createdAt: number;
}

export interface RelaySnapshot {
  version: 1;
  lastEventSequence: number;
  seasons: Record<string, Record<string, unknown>>;
  days: Record<string, Record<string, unknown>>;
  actors: Record<string, Record<string, unknown>>;
  walletBindings: Record<string, Record<string, unknown>>;
  tickets: Record<string, { id: string; actorId: string; missionDate: string; ruleset?: 'relay-1'; issuedAt?: number; expiresAt?: number; usedByRunId: string | null; consumedAt?: number | null }>;
  verifiedRuns: Record<string, RelayRunRecord>;
  dailyBests: Record<string, string>;
  worldProjections: Record<string, Record<string, unknown>>;
  rewardObligations: Record<string, Record<string, unknown>>;
  payouts: Record<string, RelayPayoutRecord>;
  chainObservations: Record<string, Record<string, unknown>>;
  auditEvents: Array<Record<string, unknown>>;
}

export interface RelayPaths {
  dataDirectory: string;
  snapshot: string;
  events: string;
  traces: string;
}

export function relayPaths(dataDirectory = process.env.DATA_DIR ?? join(process.cwd(), '.data')): RelayPaths {
  return {
    dataDirectory,
    snapshot: join(dataDirectory, 'relay.json'),
    events: join(dataDirectory, 'relay-events.ndjson'),
    traces: join(dataDirectory, 'relay-traces'),
  };
}

export function createEmptyRelaySnapshot(): RelaySnapshot {
  return {
    version: RELAY_SNAPSHOT_VERSION,
    lastEventSequence: 0,
    seasons: {},
    days: {},
    actors: {},
    walletBindings: {},
    tickets: {},
    verifiedRuns: {},
    dailyBests: {},
    worldProjections: {},
    rewardObligations: {},
    payouts: {},
    chainObservations: {},
    auditEvents: [],
  };
}

export type RelayStoreErrorCode =
  | 'relay_snapshot_corrupt'
  | 'relay_snapshot_unsupported'
  | 'relay_trace_missing'
  | 'legacy_snapshot_checksum_mismatch';

export class RelayStoreError extends Error {
  readonly code: RelayStoreErrorCode;

  constructor(code: RelayStoreErrorCode, message: string) {
    super(message);
    this.name = 'RelayStoreError';
    this.code = code;
  }
}

export interface RelayPersistenceHealth {
  status: 'healthy' | 'degraded';
  lastError: string | null;
  lastSuccessfulWriteAt: number | null;
}

export interface RelayStore {
  readonly paths: RelayPaths;
  load(): Promise<RelaySnapshot>;
  commit(kind: string, snapshot: RelaySnapshot): Promise<void>;
  flush(): Promise<void>;
  health(): RelayPersistenceHealth;
}

export interface RelayStoreOptions {
  dataDirectory?: string;
  traceDirectory?: string;
  legacySnapshotPath?: string;
  expectedLegacySnapshotSha256?: string;
  afterEventAppended?: () => Promise<void>;
}

export function createRelayStore(options: RelayStoreOptions = {}): RelayStore {
  const paths = relayPaths(options.dataDirectory);
  const traceDirectory = options.traceDirectory ?? paths.traces;
  let current: RelaySnapshot | null = null;
  let writeChain: Promise<void> = Promise.resolve();
  let persistenceHealth: RelayPersistenceHealth = { status: 'healthy', lastError: null, lastSuccessfulWriteAt: null };

  const loadUnlocked = async (): Promise<RelaySnapshot> => {
    if (options.expectedLegacySnapshotSha256 && options.legacySnapshotPath) {
      await verifyLegacySnapshotChecksum(options.legacySnapshotPath, options.expectedLegacySnapshotSha256);
    }

    let snapshot = createEmptyRelaySnapshot();
    try {
      const parsed: unknown = JSON.parse(await readFile(paths.snapshot, 'utf8'));
      snapshot = parseRelaySnapshot(parsed);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw normaliseSnapshotError(error);
    }

    const events = await readRelayEvents(paths.events);
    const latest = events.at(-1);
    if (latest && latest.sequence > snapshot.lastEventSequence) snapshot = parseRelaySnapshot(latest.snapshot);
    await verifyReferencedTraces(snapshot, traceDirectory);
    current = snapshot;
    persistenceHealth = { ...persistenceHealth, status: 'healthy', lastError: null };
    return snapshot;
  };

  const enqueue = (operation: () => Promise<void>): Promise<void> => {
    writeChain = writeChain.catch(() => undefined).then(operation);
    return writeChain;
  };

  return {
    paths,
    async load() {
      if (current) return current;
      await enqueue(async () => { await loadUnlocked(); });
      return current ?? createEmptyRelaySnapshot();
    },
    async commit(kind, snapshot) {
      await enqueue(async () => {
        const validated = parseRelaySnapshot(snapshot);
        const previous = current ?? await loadUnlocked();
        const sequence = Math.max(previous.lastEventSequence, validated.lastEventSequence) + 1;
        const materialized: RelaySnapshot = { ...validated, lastEventSequence: sequence };
        const event: RelayTransitionEvent = {
          version: 1,
          sequence,
          id: `${sequence}-${Date.now()}`,
          kind,
          at: Date.now(),
          snapshot: materialized,
        };
        try {
          await appendRelayEvent(paths.events, event);
          await options.afterEventAppended?.();
          await atomicWrite(paths.snapshot, JSON.stringify(materialized));
          current = materialized;
          persistenceHealth = { status: 'healthy', lastError: null, lastSuccessfulWriteAt: Date.now() };
        } catch (error) {
          persistenceHealth = { ...persistenceHealth, status: 'degraded', lastError: 'relay_snapshot_write_failed' };
          throw error;
        }
      });
    },
    async flush() {
      await writeChain;
    },
    health() {
      return { ...persistenceHealth };
    },
  };
}

export async function verifyLegacySnapshotChecksum(path: string, expectedSha256: string): Promise<void> {
  const actual = createHash('sha256').update(await readFile(path)).digest('hex');
  if (!/^[0-9a-f]{64}$/.test(expectedSha256) || actual !== expectedSha256) {
    throw new RelayStoreError('legacy_snapshot_checksum_mismatch', 'The legacy snapshot checksum does not match its recorded manifest.');
  }
}

export function getRelayPersistenceHealth(): RelayPersistenceHealth {
  return defaultRelayStore.health();
}

export async function loadRelayState(): Promise<RelaySnapshot> {
  return defaultRelayStore.load();
}

export function getRelayStore(): RelayStore {
  return defaultRelayStore;
}

function parseRelaySnapshot(value: unknown): RelaySnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RelayStoreError('relay_snapshot_corrupt', 'Relay snapshot is not an object.');
  if ((value as { version?: unknown }).version !== RELAY_SNAPSHOT_VERSION) {
    throw new RelayStoreError('relay_snapshot_unsupported', 'Relay snapshot version is unsupported.');
  }
  const snapshot = value as Partial<RelaySnapshot>;
  const required = ['seasons', 'days', 'actors', 'walletBindings', 'tickets', 'verifiedRuns', 'dailyBests', 'worldProjections', 'rewardObligations', 'payouts', 'chainObservations', 'auditEvents'] as const;
  const lastEventSequence = snapshot.lastEventSequence;
  const hasObject = (field: keyof RelaySnapshot): boolean => {
    const candidate = snapshot[field];
    return Boolean(candidate && typeof candidate === 'object' && !Array.isArray(candidate));
  };
  if (typeof lastEventSequence !== 'number' || !Number.isSafeInteger(lastEventSequence) || lastEventSequence < 0 || required.slice(0, -1).some((field) => !hasObject(field)) || !Array.isArray(snapshot.auditEvents)) {
    throw new RelayStoreError('relay_snapshot_corrupt', 'Relay snapshot is missing required state.');
  }
  return snapshot as RelaySnapshot;
}

function normaliseSnapshotError(error: unknown): RelayStoreError {
  if (error instanceof RelayStoreError) return error;
  return new RelayStoreError('relay_snapshot_corrupt', 'Relay snapshot is corrupt or unreadable.');
}

async function verifyReferencedTraces(snapshot: RelaySnapshot, traceDirectory: string): Promise<void> {
  for (const run of Object.values(snapshot.verifiedRuns)) {
    if (!run || typeof run.traceHash !== 'string') throw new RelayStoreError('relay_snapshot_corrupt', 'Verified run is malformed.');
    try {
      await access(join(traceDirectory, `${run.traceHash}.trace`));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new RelayStoreError('relay_trace_missing', `Trace ${run.traceHash} is missing.`);
      throw error;
    }
  }
}

async function atomicWrite(path: string, contents: string): Promise<void> {
  await mkdir(pathsDirectory(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, contents, 'utf8');
  await rename(temporary, path);
}

function pathsDirectory(path: string): string {
  const separator = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return separator === -1 ? '.' : path.slice(0, separator);
}

const defaultRelayStore = createRelayStore();
