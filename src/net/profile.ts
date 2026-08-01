/**
 * The pilot's record, mirrored locally.
 *
 * Rank appears on the first screen a player sees, so it cannot wait on a round
 * trip. The last known profile is kept in local storage and rendered
 * immediately; the server's copy replaces it when it arrives, which is
 * normally before anyone has finished reading the mission brief.
 *
 * The server is authoritative and the mirror is a cache. Anywhere the two
 * disagree, the server wins, and the mirror exists only so the first paint has
 * something true-ish to show instead of a dash.
 */

import { rankFor, type RankProgress } from '../data/story';

import { networkHeaders } from '../core/network';

const API_BASE = import.meta.env.VITE_API_BASE ?? '';
const STORAGE_KEY = 'sface.profile';

export interface Profile {
  id: string;
  name: string;
  avatarUrl: string | null;
  clanTag: string | null;

  lifetimeFace: number;
  runs: number;
  bestScore: number;
  rescued: number;
  caches: number;
  relics: number;
  extractions: number;
  /** Highest campaign stage cleared, 0 to 7. */
  stagesCleared: number;

  /**
   * Staked contests lost, and how many were paid.
   *
   * The settlement record. There is no escrow, so nothing makes a loser pay;
   * what the app can do is make not paying legible to whoever is deciding
   * whether to stake against them.
   */
  stakesOwed: number;
  stakesSettled: number;

  /**
   * Runs on the board carrying no signature.
   *
   * Everything needed to sign one after the fact: a signature is made over the
   * date, seed, stage and score, so a reminder that could not name all four
   * would be a nag with no button behind it.
   */
  unsigned?: UnsignedRun[];

  /** Position on the all-time board. Zero until they have scored. */
  allTimeRank?: number;
}

export interface UnsignedRun {
  date: string;
  seed: string;
  stage: number;
  score: number;
}

export function emptyProfile(id: string, name: string): Profile {
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
    stakesOwed: 0,
    stakesSettled: 0,
  };
}

let cached: Profile | null = null;

/** The last known profile, instantly. Null before the first run ever. */
export function localProfile(): Profile | null {
  if (cached) return cached;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    cached = raw ? (parse(JSON.parse(raw)) ?? null) : null;
  } catch {
    cached = null;
  }
  return cached;
}

export function cacheProfile(profile: Profile): void {
  cached = profile;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Private mode. It re-fetches next session, which is the same outcome
    // one round trip later.
  }
}

export function clearProfile(): void {
  cached = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** Fetch the authoritative copy. Returns null on anything unexpected. */
export function progressOf(profile: Profile | null): RankProgress {
  return rankFor(profile?.lifetimeFace ?? 0);
}

export async function fetchProfile(id: string): Promise<Profile | null> {
  if (!API_BASE) return null;

  try {
    const response = await fetch(`${API_BASE}/profile/${encodeURIComponent(id)}`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return null;

    const profile = parse(await response.json());
    if (profile) cacheProfile(profile);
    return profile;
  } catch {
    return null;
  }
}

/**
 * Validate a profile off the wire.
 *
 * It drives a rank badge and a progress bar, so a missing number renders as
 * NaN and a negative one renders as a bar running backwards. Everything is
 * coerced rather than trusted.
 */
export function parse(raw: unknown): Profile | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;

  const id = typeof value.id === 'string' ? value.id : '';
  if (!id) return null;

  return {
    id,
    name: typeof value.name === 'string' && value.name ? value.name.slice(0, 32) : 'Pilot',
    avatarUrl: typeof value.avatarUrl === 'string' ? value.avatarUrl : null,
    clanTag: typeof value.clanTag === 'string' ? value.clanTag.slice(0, 4) : null,
    lifetimeFace: count(value.lifetimeFace),
    runs: count(value.runs),
    bestScore: count(value.bestScore),
    rescued: count(value.rescued),
    caches: count(value.caches),
    relics: count(value.relics),
    extractions: count(value.extractions),
    stagesCleared: Math.min(7, count(value.stagesCleared)),
    stakesOwed: count(value.stakesOwed),
    // Never more than were owed. A record that reads better than perfect is a
    // broken record, and this one is the whole point of the panel.
    stakesSettled: Math.min(count(value.stakesOwed), count(value.stakesSettled)),
    unsigned: unsignedRuns(value.unsigned),
    allTimeRank: count(value.allTimeRank),
  };
}

/**
 * Only rows that carry all four fields.
 *
 * A partial one cannot be signed, so offering it would be a button that fails
 * when pressed rather than a reminder that leads somewhere.
 */
function unsignedRuns(value: unknown): UnsignedRun[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter(
      (row): row is UnsignedRun =>
        !!row &&
        typeof row.date === 'string' &&
        typeof row.seed === 'string' &&
        row.seed.length > 0 &&
        typeof row.stage === 'number' &&
        typeof row.score === 'number',
    )
    .slice(0, 10);
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

/**
 * Fold a device's record into the connected account's.
 *
 * Never rejects and never blocks anything: a failed merge leaves both records
 * where they were, which is exactly the state before accounts carried progress.
 */
export async function mergeProfile(from: string, into: string): Promise<boolean> {
  if (!API_BASE || from === into) return false;

  try {
    const response = await fetch(`${API_BASE}/profile/merge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...networkHeaders() },
      body: JSON.stringify({ from, into }),
    });
    if (!response.ok) return false;

    const body = (await response.json()) as { merged?: boolean };
    return body.merged === true;
  } catch {
    return false;
  }
}
