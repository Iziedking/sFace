/**
 * Persistence, such as it is.
 *
 * A JSON snapshot on disk, written on a debounce. This is deliberately not a
 * database: the whole dataset is one day of scores and a handful of challenges,
 * it is rewritten nightly, and nothing here is money. A restart losing the
 * board would be embarrassing during judging, and that is the entire problem
 * this solves.
 *
 * The write is atomic. Writing in place means a process killed mid-write leaves
 * a truncated file that fails to parse on the next boot, which is the same as
 * having no persistence at all but harder to notice.
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
  /**
   * The day's frozen mission. Not a cache: challenges are bets on a specific
   * seed, and recomposing after a restart would change it. See server/daily.ts.
   */
  mission: unknown;
  /** Public player credentials only. Challenges and signatures are never persisted. */
  playerAuth?: PlayerAuthSnapshot;
}

let pending: NodeJS.Timeout | null = null;
let latest: (() => Snapshot) | null = null;

export async function loadSnapshot(): Promise<Snapshot | null> {
  try {
    const raw = await readFile(SNAPSHOT, 'utf8');
    const parsed = JSON.parse(raw) as Snapshot;
    return parsed.version === 1 ? parsed : null;
  } catch {
    // No file yet, or it is unreadable. Either way we start empty.
    return null;
  }
}

/**
 * Ask for a save. Repeated calls inside the debounce window collapse into one
 * write, so a burst of score posts does not become a burst of disk writes.
 */
export function scheduleSave(produce: () => Snapshot): void {
  latest = produce;
  if (pending) return;

  pending = setTimeout(() => {
    pending = null;
    const producer = latest;
    latest = null;
    if (producer) void save(producer());
  }, DEBOUNCE_MS);
  // Do not hold the process open just to flush a leaderboard.
  pending.unref?.();
}

/**
 * Copy the snapshot aside before something rewrites it in a new shape.
 *
 * ## Why a migration gets a backup and an ordinary write does not
 *
 * Every other write here replaces data with the same data plus a change. A
 * migration replaces it with data in a shape that has never been on this disk,
 * produced by code that has never run against this exact file. If the reading
 * half of that is wrong, the writing half destroys the evidence, and the
 * failure is silent: profiles do not crash when they load as zeroes, they just
 * quietly stop being worth anything.
 *
 * So the original is kept, named for the day it was set aside. Nothing deletes
 * these. They are small, they are rare, and the moment you want one is the
 * moment you cannot make another.
 *
 * A failed backup returns false and the caller must not proceed. Migrating
 * anyway because the safety net tore is how a safety net becomes decoration.
 */
export async function backupSnapshot(label: string): Promise<string | null> {
  const target = `${SNAPSHOT}.${label}.bak`;
  try {
    await copyFile(SNAPSHOT, target);
    return target;
  } catch (error) {
    // No file to copy is fine and not a failure: a fresh install has nothing
    // to lose. Anything else is a real refusal to proceed.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return target;
    console.error('[sface] snapshot backup failed', error);
    return null;
  }
}

/** Write now, skipping the debounce. Used once at boot by the migration. */
export async function saveNow(snapshot: Snapshot): Promise<void> {
  await save(snapshot);
}

/** Flush immediately. Called on shutdown so the last writes are not lost. */
export async function flush(): Promise<void> {
  if (pending) {
    clearTimeout(pending);
    pending = null;
  }
  const producer = latest;
  latest = null;
  if (producer) await save(producer());
}

async function save(snapshot: Snapshot): Promise<void> {
  try {
    await mkdir(dirname(SNAPSHOT), { recursive: true });
    const temp = `${SNAPSHOT}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(snapshot), 'utf8');
    await rename(temp, SNAPSHOT);
  } catch (error) {
    // Losing the snapshot must never take the service with it.
    console.error('[sface] snapshot write failed', error);
  }
}
