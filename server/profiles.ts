/**
 * What a pilot has done, for as long as they keep the same identity.
 *
 * This is what turns a good run into progress. The daily board resets every
 * midnight, which is correct for a daily challenge and useless as a reason to
 * come back: nothing you did on Tuesday exists on Friday. A profile
 * accumulates, so a great run keeps counting.
 *
 * ## Every run counts, not the best one
 *
 * The leaderboard keeps a pilot's best run of the day, because a board is a
 * ranking. A profile adds every run, because it is a record of showing up.
 * Those are different questions and they want different answers, which is why
 * this is a separate store rather than a column on the board.
 *
 * The obvious objection is that it rewards grinding. It does, and that is
 * intended: rank is a record, never a power. A tier eight pilot flies the
 * identical mission to a tier one, and the daily board still ranks them purely
 * on skill.
 *
 * Lifetime Face does open weapons, which sounds like it contradicts the
 * paragraph above and does not. Every gun in src/data/weapons.ts is a sidegrade
 * with a stated cost, so a full rack is more ways to fly and never more damage.
 * The rule is written out at the top of that file, and if a future edit breaks
 * it the daily challenge stops being a fair bet.
 *
 * ## What stops it being nonsense
 *
 * Nothing here is verified, and it is not presented as though it were. Runs
 * arrive through the same plausibility bounds the board uses: a score above
 * the game's maximum, a duration a run cannot have, or a high score against an
 * impossibly short run are all refused before they reach this file. Beyond
 * that it is a record of what a client claimed, and the README says so.
 */

export interface Profile {
  id: string;
  name: string;
  /** Only set when they connected an account and shared a picture. */
  avatarUrl: string | null;
  /** Four characters, uppercase. Null until they join one. */
  clanTag: string | null;

  lifetimeFace: number;
  runs: number;
  bestScore: number;
  /** People who reached extraction, across every run. */
  rescued: number;
  caches: number;
  relics: number;
  /** Runs that reached the pad rather than ending in the ground. */
  extractions: number;
  /**
   * Highest campaign stage cleared, 0 to 7.
   *
   * Kept here rather than on the daily board because it is the one number that
   * has to survive midnight. A campaign that reset every day would not be a
   * campaign.
   */
  stagesCleared: number;

  firstSeen: number;
  lastSeen: number;
}

export interface RunRecord {
  id: string;
  name: string;
  avatarUrl: string | null;
  score: number;
  rescued: number;
  caches: number;
  relics: number;
  extracted: boolean;
  /** The stage this run was flown on, and whether it met the objective. */
  stage?: number;
  stageCleared?: boolean;
}

const profiles = new Map<string, Profile>();

/** A profile that exists only in memory, for a pilot we have never seen. */
export function blank(id: string, name: string): Profile {
  const now = Date.now();
  return {
    id,
    name,
    avatarUrl: null,
    clanTag: null,
    lifetimeFace: 0,
    runs: 0,
    bestScore: 0,
    rescued: 0,
    caches: 0,
    relics: 0,
    extractions: 0,
    stagesCleared: 0,
    firstSeen: now,
    lastSeen: now,
  };
}

export function get(id: string): Profile | null {
  return profiles.get(id) ?? null;
}

/** Fold a finished run into a profile, creating it on first sight. */
export function record(run: RunRecord): Profile {
  const existing = profiles.get(run.id) ?? blank(run.id, run.name);

  const updated: Profile = {
    ...existing,
    // The display name follows the latest run, so connecting an X account
    // mid-session updates a pilot everywhere rather than leaving a stale
    // generated callsign on the board.
    name: run.name,
    avatarUrl: run.avatarUrl ?? existing.avatarUrl,
    lifetimeFace: existing.lifetimeFace + Math.max(0, run.score),
    runs: existing.runs + 1,
    bestScore: Math.max(existing.bestScore, run.score),
    rescued: existing.rescued + Math.max(0, run.rescued),
    caches: existing.caches + Math.max(0, run.caches),
    relics: existing.relics + Math.max(0, run.relics),
    extractions: existing.extractions + (run.extracted ? 1 : 0),
    // Only ever forward, and only one at a time. A client claiming it cleared
    // Stage 7 having never cleared Stage 1 gets the next stage in order, which
    // is the same guard the unlock rule uses on the way in.
    stagesCleared:
      run.stageCleared && (run.stage ?? 0) === existing.stagesCleared + 1
        ? existing.stagesCleared + 1
        : existing.stagesCleared,
    lastSeen: Date.now(),
  };

  profiles.set(run.id, updated);
  persist();
  return updated;
}

/** Set or clear a pilot's clan. Used by the clan endpoints. */
export function setClan(id: string, clanTag: string | null): Profile | null {
  const profile = profiles.get(id);
  if (!profile) return null;

  profile.clanTag = clanTag;
  persist();
  return profile;
}

/** Ensure a profile exists so a pilot can join a clan before their first run. */
export function ensure(id: string, name: string): Profile {
  const existing = profiles.get(id);
  if (existing) return existing;

  const created = blank(id, name);
  profiles.set(created.id, created);
  persist();
  return created;
}

/** Every profile, in no particular order. Used to fold the clan table. */
export function all(): Profile[] {
  return [...profiles.values()];
}

/** All-time board, ranked on lifetime Face. */
export function allTime(limit: number): Profile[] {
  return [...profiles.values()]
    .filter((p) => p.lifetimeFace > 0)
    .sort((a, b) => b.lifetimeFace - a.lifetimeFace || a.firstSeen - b.firstSeen)
    .slice(0, Math.max(0, limit));
}

/** Where a pilot sits all-time, 1-based. Zero when they have never scored. */
export function rankOf(id: string): number {
  const profile = profiles.get(id);
  if (!profile || profile.lifetimeFace <= 0) return 0;

  let above = 0;
  for (const other of profiles.values()) {
    if (other.id === id) continue;
    if (
      other.lifetimeFace > profile.lifetimeFace ||
      (other.lifetimeFace === profile.lifetimeFace && other.firstSeen < profile.firstSeen)
    ) {
      above++;
    }
  }
  return above + 1;
}

/** Everyone in a clan. Used for the clan totals board. */
export function membersOf(clanTag: string): Profile[] {
  return [...profiles.values()].filter((p) => p.clanTag === clanTag);
}

export function count(): number {
  return profiles.size;
}

// Persistence -------------------------------------------------------------

export function serialise(): unknown {
  return [...profiles.values()];
}

export function restore(raw: unknown): void {
  if (!Array.isArray(raw)) return;

  // Replace rather than merge. A snapshot is a statement about the whole store,
  // not an addition to it, so restoring twice has to leave the same result as
  // restoring once. At boot the map is empty and this clear is a no-op.
  profiles.clear();

  for (const item of raw as Profile[]) {
    if (!item || typeof item.id !== 'string') continue;
    // Fill in fields added after a snapshot was written, so an older file
    // loads instead of producing a profile full of undefined.
    profiles.set(item.id, {
      ...blank(item.id, item.name ?? 'Pilot'),
      ...item,
    });
  }
}

let persist: () => void = () => {};

export function onChange(handler: () => void): void {
  persist = handler;
}
