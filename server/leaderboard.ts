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

import { STAGES } from '../src/data/campaign';

/**
 * A coarse outer bound, not the real check.
 *
 * verify.ts builds the actual level from the seed and refuses anything that
 * level cannot pay, which is exact and per-seed. This exists only to throw out
 * numbers that are not worth building a level for.
 *
 * It used to be 60,000, which is BELOW what a good stage seven run can legally
 * earn: the per-level ceiling for that stage comes out near 70,000. Its own
 * comment records this exact mistake happening once before, when the ceiling
 * was 30,000 and honest runs were being refused. A static ceiling set near the
 * real maximum will always eventually cross it, so this one is set far above
 * anything reachable and left to do the only job it is good for.
 *
 * Worked out rather than guessed, because the old value was wrong. Every
 * person out, every cache including the relic, every attacker a busy level
 * holds, a full time bonus, and the largest bounty multiplier comes to about
 * 36,000. The ceiling was 30,000, which meant a genuinely excellent run was
 * refused with a 422 and never reached the board at all. It was introduced
 * the moment caches started paying Face and nobody had scored highly enough
 * to trip it yet.
 */
export const SCORE_CEILING = 250_000;

/**
 * The longest stage in the campaign, plus slack for the frame it ends on.
 *
 * Derived, because the hand-written version was wrong and wrong silently. It
 * was 118, from a comment reading "a run is 110 seconds", which was true when
 * stage one was the longest thing in the game. Stages then grew: the finale is
 * a march through five sealed regions and stage six is a reading stage, both
 * far longer than 110. Nothing failed at build time. The zod schema simply
 * refused every long run with a 400 before it ever reached the verifier, so
 * clearing stage six or seven and posting the score became impossible while
 * every test stayed green.
 *
 * Reading it off STAGES means the next clock change carries this with it.
 */
export const MAX_DURATION = Math.max(...STAGES.map((stage) => stage.seconds)) + 8;
const BOARD_LIMIT = 100;

export interface Entry {
  id: string;
  name: string;
  score: number;
  facesExtracted: number;
  attackersCleared: number;
  at: number;
  /**
   * The Nimiq address that signed for this score, when one did.
   *
   * Derived on the service from the public key that produced a valid
   * signature, never accepted from the client. Null for a row posted without
   * a wallet, which is every row from a plain browser and is fine: the board
   * has always taken unsigned rows and says which is which.
   */
  address?: string | null;
}

export interface PublicEntry {
  id: string;
  name: string;
  score: number;
  /** Present only on rows a wallet signed for. Shown as a verified mark. */
  address?: string | null;
}

export interface SubmitInput {
  deviceId: string;
  name: string;
  date: string;
  score: number;
  facesExtracted: number;
  attackersCleared: number;
  duration: number;
  /** Verified address, or null. The route verifies; this module only stores. */
  address?: string | null;
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
      address: input.address ?? null,
    });
    persist();
  }

  return { ok: true, rank: rankOf(input.date, input.deviceId) };
}

export function top(date: string, limit = BOARD_LIMIT): PublicEntry[] {
  return sorted(date)
    .slice(0, limit)
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      score: entry.score,
      address: entry.address ?? null,
    }));
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
