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

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

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
