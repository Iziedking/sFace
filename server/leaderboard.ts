/**
 * The daily leaderboard, keyed by device identifier.
 *
 * On score verification, honestly: a client can lie about its score, and this
 * build does not replay input traces to prove otherwise. What it does instead
 * is proportionate and stated plainly in the README rather than dressed up as
 * security:
 *
 *   - Scores above a ceiling derived from the game's own maximums are refused,
 *     so the board cannot be filled with nonsense.
 *   - The run duration has to be physically possible for the score claimed.
 *   - One entry per device per day, best score kept, so a bot cannot flood it.
 *
 * That is a speed bump, not a lock. Calling it verified would be a lie, and an
 * unverifiable claim on a leaderboard costs less than a false one.
 */

/**
 * Every face out, every attacker a busy level can hold, a full time bonus, and
 * the largest bounty multiplier. Comfortably above a perfect human run and far
 * below what a fabricated score looks like.
 */
export const SCORE_CEILING = 30_000;
/** A run is 90 seconds. Allow a little slack for frame timing. */
export const MAX_DURATION = 95;
const BOARD_LIMIT = 100;

export interface Entry {
  id: string;
  name: string;
  score: number;
  facesExtracted: number;
  attackersCleared: number;
  at: number;
}

export interface PublicEntry {
  id: string;
  name: string;
  score: number;
}

export interface SubmitInput {
  deviceId: string;
  name: string;
  date: string;
  score: number;
  facesExtracted: number;
  attackersCleared: number;
  duration: number;
}

export type SubmitResult =
  | { ok: true; rank: number }
  | { ok: false; reason: string };

/** date -> deviceId -> entry */
const boards = new Map<string, Map<string, Entry>>();

export function submit(input: SubmitInput): SubmitResult {
  const rejection = implausible(input);
  if (rejection) return { ok: false, reason: rejection };

  const board = boards.get(input.date) ?? new Map<string, Entry>();
  boards.set(input.date, board);

  const existing = board.get(input.deviceId);

  // Keep the best run of the day rather than the latest, so a bad run after a
  // good one does not cost someone their rank.
  if (!existing || input.score > existing.score) {
    board.set(input.deviceId, {
      id: input.deviceId,
      name: input.name,
      score: input.score,
      facesExtracted: input.facesExtracted,
      attackersCleared: input.attackersCleared,
      at: Date.now(),
    });
    persist();
  }

  return { ok: true, rank: rankOf(input.date, input.deviceId) };
}

export function top(date: string, limit = BOARD_LIMIT): PublicEntry[] {
  return sorted(date)
    .slice(0, limit)
    .map((entry) => ({ id: entry.id, name: entry.name, score: entry.score }));
}

export function rankOf(date: string, deviceId: string): number {
  const index = sorted(date).findIndex((entry) => entry.id === deviceId);
  return index === -1 ? 0 : index + 1;
}

function sorted(date: string): Entry[] {
  const board = boards.get(date);
  if (!board) return [];
  // Ties break on who got there first. Arbitrary, but stable, and a board that
  // reorders on refresh looks broken.
  return [...board.values()].sort((a, b) => b.score - a.score || a.at - b.at);
}

/** Cheap sanity checks. Not proof, and not presented as proof. */
function implausible(input: SubmitInput): string | null {
  if (input.score < 0 || !Number.isFinite(input.score)) return 'Score is not a number.';
  if (input.score > SCORE_CEILING) return 'Score is above the possible maximum.';
  if (input.duration <= 0 || input.duration > MAX_DURATION) return 'Run duration is impossible.';
  if (input.facesExtracted < 0 || input.facesExtracted > 5) return 'Face count is impossible.';
  if (input.attackersCleared < 0 || input.attackersCleared > 200) {
    return 'Kill count is impossible.';
  }
  // Nobody clears the level in under ten seconds, and a score claimed against
  // one is the cheapest possible forgery.
  if (input.duration < 10 && input.score > 2000) return 'Score is too high for that duration.';
  return null;
}

// Persistence -------------------------------------------------------------

export function serialise(): unknown {
  return [...boards.entries()].map(([date, board]) => [date, [...board.values()]]);
}

export function restore(raw: unknown): void {
  if (!Array.isArray(raw)) return;

  for (const pair of raw) {
    if (!Array.isArray(pair) || pair.length !== 2) continue;
    const [date, entries] = pair as [unknown, unknown];
    if (typeof date !== 'string' || !Array.isArray(entries)) continue;

    const board = new Map<string, Entry>();
    for (const entry of entries as Entry[]) {
      if (entry && typeof entry.id === 'string' && typeof entry.score === 'number') {
        board.set(entry.id, entry);
      }
    }
    boards.set(date, board);
  }
}

/** Drop boards older than a week. This service is not an archive. */
export function prune(today: string): void {
  const cutoff = Date.parse(`${today}T00:00:00Z`) - 7 * 86_400_000;
  for (const date of boards.keys()) {
    if (Date.parse(`${date}T00:00:00Z`) < cutoff) boards.delete(date);
  }
}

let persist: () => void = () => {};

/** Wired from index.ts so this module does not import the snapshot shape. */
export function onChange(handler: () => void): void {
  persist = handler;
}
