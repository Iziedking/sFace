/**
 * Atomic snapshot persistence for the API process.
 *
 * A missing file is a fresh install. Corrupt, unsupported, or unreadable data
 * is a startup failure because booting empty would overwrite the evidence on
 * the next write and make player state loss look successful.
 */

import { copyFile, readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { PlayerAuthSnapshot } from './player-auth';

const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), '.data');
const SNAPSHOT = join(DATA_DIR, 'sface.json');
const DEBOUNCE_MS = 1500;

export interface Snapshot {
  version: 1;
  scores: unknown;
  challenges: unknown;
  mission: unknown;
  playerAuth?: PlayerAuthSnapshot;
  [key: string]: unknown;
}

export type SnapshotLoadResult =
  | { ok: true; value: Snapshot | null }
  | { ok: false; error: 'snapshot_corrupt' | 'snapshot_unsupported' | 'snapshot_unreadable' };

export interface PersistenceHealth {
  status: 'healthy' | 'degraded';
  lastError: string | null;
  lastSuccessfulWriteAt: number | null;
}

let health: PersistenceHealth = {
  status: 'healthy',
  lastError: null,
  lastSuccessfulWriteAt: null,
};
let pending: NodeJS.Timeout | null = null;
let latest: (() => Snapshot) | null = null;

export function getPersistenceHealth(): PersistenceHealth {
  return { ...health };
}

export function parseSnapshot(raw: string): SnapshotLoadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'snapshot_corrupt' };
  }
  if (!parsed || typeof parsed !== 'object' || !('version' in parsed)) {
    return { ok: false, error: 'snapshot_corrupt' };
  }
  if ((parsed as { version?: unknown }).version !== 1) {
    return { ok: false, error: 'snapshot_unsupported' };
  }
  return { ok: true, value: parsed as Snapshot };
}

export function persistenceStatusFromError(error: unknown): SnapshotLoadResult {
  if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') {
    return { ok: true, value: null };
  }
  return { ok: false, error: 'snapshot_unreadable' };
}

export async function loadSnapshot(): Promise<SnapshotLoadResult> {
  try {
    const result = parseSnapshot(await readFile(SNAPSHOT, 'utf8'));
    if (!result.ok) markDegraded(result.error);
    return result;
  } catch (error) {
    const result = persistenceStatusFromError(error);
    if (!result.ok) markDegraded(result.error);
    return result;
  }
}

export function scheduleSave(produce: () => Snapshot): void {
  latest = produce;
  if (pending) return;

  pending = setTimeout(() => {
    pending = null;
    const producer = latest;
    latest = null;
    if (producer) {
      void save(producer()).catch((error: unknown) => {
        console.error('[sface] snapshot write failed', error);
      });
    }
  }, DEBOUNCE_MS);
  pending.unref?.();
}

export async function backupSnapshot(label: string): Promise<string | null> {
  const target = `${SNAPSHOT}.${label}.bak`;
  try {
    await copyFile(SNAPSHOT, target);
    return target;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return target;
    markDegraded('snapshot_backup_failed');
    console.error('[sface] snapshot backup failed', error);
    return null;
  }
}

export async function saveNow(snapshot: Snapshot): Promise<void> {
  await save(snapshot);
}

export async function flush(): Promise<void> {
  if (pending) {
    clearTimeout(pending);
    pending = null;
  }
  const producer = latest;
  latest = null;
  if (producer) await save(producer());
}

function markDegraded(error: string): void {
  health = { ...health, status: 'degraded', lastError: error };
}

async function save(snapshot: Snapshot): Promise<void> {
  try {
    await mkdir(dirname(SNAPSHOT), { recursive: true });
    const temp = `${SNAPSHOT}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(snapshot), 'utf8');
    await rename(temp, SNAPSHOT);
    health = { status: 'healthy', lastError: null, lastSuccessfulWriteAt: Date.now() };
  } catch (error) {
    markDegraded('snapshot_write_failed');
    throw error;
  }
}
