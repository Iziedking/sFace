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
  /**
   * Which chain this record belongs to.
   *
   * The pilot id is already scoped by network on the client, so two networks
   * never collide on a key. This is here because the clan table has to GROUP
   * profiles, and grouping needs to know which ones belong together: scanning
   * for a clan tag without it would pool a mainnet clan and a testnet clan of
   * the same name into one row.
   *
   * Absent on records written before the split, which were all mainnet.
   */
  network?: string;
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
  /** Which chain the run was played on. Decides the record it lands in. */
  network?: string;
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
export function blank(id: string, name: string, network = 'main'): Profile {
  const now = Date.now();
  return {
    id,
    name,
    network,
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
  const existing = profiles.get(run.id) ?? blank(run.id, run.name, run.network ?? 'main');

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

/**
 * Fold one profile into another and retire the first.
 *
 * ## Why this exists
 *
 * A record used to be keyed on the device it was earned on, so the same person
 * on a phone and a laptop was two players with two piles of Face. Identity is
 * the X account, and progress should follow it, so a client that signs in tells
 * us which device record belongs to which account and this joins them.
 *
 * ## Merge, never overwrite
 *
 * The obvious implementation replaces one with the other, and it is wrong in a
 * case that will absolutely happen: somebody plays anonymously on their phone,
 * plays anonymously on their laptop, then signs in on both. A replace means
 * whichever they signed into second silently destroys the first. So totals are
 * summed and bests are taken, which is correct however many devices arrive and
 * in whatever order.
 *
 * ## Idempotent
 *
 * The source is deleted once folded in, so a client that retries, or signs in
 * twice, cannot count the same runs again. That matters because sign-in is a
 * page redirect and redirects get repeated.
 */
export function merge(fromId: string, intoId: string): Profile | null {
  if (fromId === intoId) return profiles.get(intoId) ?? null;

  const from = profiles.get(fromId);
  if (!from) {
    // Nothing to fold in. Not an error: the usual case is somebody signing in
    // on a device that has never finished a run.
    return profiles.get(intoId) ?? null;
  }

  const into = profiles.get(intoId);

  if (!into) {
    /*
     * The account has no record yet, so the device's becomes it.
     *
     * Re-keyed rather than copied field by field, which keeps firstSeen honest:
     * the account has been playing since that device started, not since the
     * moment it signed in.
     */
    const moved: Profile = { ...from, id: intoId };
    profiles.set(intoId, moved);
    profiles.delete(fromId);
    persist();
    return moved;
  }

  const merged: Profile = {
    ...into,
    // Totals add. Two devices are two sets of runs by one person.
    lifetimeFace: into.lifetimeFace + from.lifetimeFace,
    runs: into.runs + from.runs,
    rescued: into.rescued + from.rescued,
    caches: into.caches + from.caches,
    relics: into.relics + from.relics,
    extractions: into.extractions + from.extractions,
    // Bests take the better. A personal best is a personal best wherever it
    // happened.
    bestScore: Math.max(into.bestScore, from.bestScore),
    stagesCleared: Math.max(into.stagesCleared, from.stagesCleared),
    // The account keeps its own name and picture, which came from X and are
    // more authoritative than a generated callsign.
    avatarUrl: into.avatarUrl ?? from.avatarUrl,
    // A clan already joined on the account wins; otherwise inherit the device's,
    // so somebody who joined one before signing in does not lose it.
    clanTag: into.clanTag ?? from.clanTag,
    firstSeen: Math.min(into.firstSeen, from.firstSeen),
    lastSeen: Math.max(into.lastSeen, from.lastSeen),
  };

  profiles.set(intoId, merged);
  profiles.delete(fromId);
  persist();
  return merged;
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
export function ensure(id: string, name: string, network = 'main'): Profile {
  const existing = profiles.get(id);
  if (existing) return existing;

  const created = blank(id, name, network);
  profiles.set(created.id, created);
  persist();
  return created;
}

/** Every profile, in no particular order. Used to fold the clan table. */
export function all(network?: string): Profile[] {
  const rows = [...profiles.values()];
  if (!network) return rows;
  // A record with no network predates the split and is mainnet.
  return rows.filter((p) => (p.network ?? 'main') === network);
}

/** All-time board, ranked on lifetime Face. */
export function allTime(limit: number, network = 'main'): Profile[] {
  return [...profiles.values()]
    .filter((p) => (p.network ?? 'main') === network)
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
export function membersOf(clanTag: string, network = 'main'): Profile[] {
  // Scoped, or a clan tag that exists on both chains returns both rosters and
  // the heir to a mainnet clan could be somebody who only plays on testnet.
  return [...profiles.values()].filter(
    (p) => p.clanTag === clanTag && (p.network ?? 'main') === network,
  );
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
