/**
 * One mission per UTC day, cached hard.
 *
 * CoinGecko's free tier rate-limits aggressively, and every player in the world
 * hits this endpoint on open. So the market is read once a day, the result is
 * held, and every request is served from memory. A cache miss here is not a
 * slow response, it is a ban.
 *
 * Three behaviours worth knowing:
 *
 *   - A failed refresh serves the previous day's payload rather than an error,
 *     because a day-old chart is a playable level and a 503 is not. The staleness
 *     is reported so the client can label it.
 *   - Retries back off, so a CoinGecko outage does not turn into a request loop.
 *   - Only one refresh runs at a time. Without that, the first ten requests
 *     after midnight each start their own fetch.
 */

import { composeMission, type MissionPayload } from './oracle';

const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 15 * 60_000;

interface Cached {
  payload: MissionPayload;
  fetchedAt: number;
}

let cached: Cached | null = null;
let inFlight: Promise<MissionPayload | null> | null = null;
let failures = 0;
let nextAttemptAt = 0;

export interface MissionResponse {
  payload: MissionPayload;
  /** True when this is not today's data. The client says so on the brief. */
  stale: boolean;
}

export async function getMission(options: { rehearsal?: boolean } = {}): Promise<MissionResponse | null> {
  const today = utcDate();

  if (cached?.payload.date === today) {
    return { payload: cached.payload, stale: false };
  }

  /*
   * A rehearsal never pays to build a mission.
   *
   * Testing reloads this endpoint constantly, and every miss on the cache is a
   * metered read of the market and of X. A testnet caller gets whatever is
   * already in hand: yesterday's chart if we have it, and the client's own
   * practice mission if we do not. Both are real levels made of real numbers, so
   * nothing about the test is weakened by declining to pay for a fresh one.
   *
   * Note the ordering. It sits after the cache hit, so a testnet session on a
   * day the cache is warm still gets today's genuine mission for free.
   */
  if (options.rehearsal) {
    if (cached) return { payload: cached.payload, stale: true };
    return null;
  }

  const fresh = await refresh();
  if (fresh) return { payload: fresh, stale: false };

  // Refresh failed. A yesterday chart still makes a real level.
  if (cached) return { payload: cached.payload, stale: true };
  return null;
}

async function refresh(): Promise<MissionPayload | null> {
  if (inFlight) return inFlight;
  if (Date.now() < nextAttemptAt) return null;

  inFlight = (async () => {
    try {
      const payload = await composeMission();
      cached = { payload, fetchedAt: Date.now() };
      failures = 0;
      nextAttemptAt = 0;
      // Freeze it to disk immediately. A restart between here and the next
      // write would otherwise recompose against a moved market.
      persist();
      console.log(
        `[sface] mission ${payload.date} ${payload.ticker} ${payload.changePct.toFixed(2)}% fng=${payload.fearGreed}`,
      );
      return payload;
    } catch (error) {
      failures++;
      const wait = Math.min(RETRY_BASE_MS * 2 ** (failures - 1), RETRY_MAX_MS);
      nextAttemptAt = Date.now() + wait;
      console.error(
        `[sface] mission refresh failed (${failures}), next attempt in ${Math.round(wait / 1000)}s`,
        error,
      );
      return null;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * Warm the cache at boot and once an hour after. The hourly tick is what rolls
 * the mission over at midnight UTC without a cron entry, and it retries through
 * the day if the market was unreachable at the rollover.
 */
export function startRefreshLoop(): NodeJS.Timeout {
  void refresh();
  const timer = setInterval(() => void getMission(), 3_600_000);
  timer.unref?.();
  return timer;
}

export function utcDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function cacheAge(): number | null {
  return cached ? Date.now() - cached.fetchedAt : null;
}

// Persistence -------------------------------------------------------------

/*
 * The day's mission has to survive a restart, and this is a correctness
 * requirement rather than a nicety.
 *
 * The seed is built from the day's data, including the 24 hour change, which
 * moves continuously. Recomposing at 14:00 produces a different seed from the
 * one composed at 00:00, and therefore a different level. Any challenge
 * created before the restart would then be replayed by the opponent on a
 * level that is not the one the creator played, and the bet would settle on
 * two different games without anyone seeing an error.
 *
 * So the mission is composed once per UTC day and then frozen, and freezing it
 * only means anything if it outlives the process.
 */

export function serialise(): unknown {
  return cached;
}

export function restore(raw: unknown): void {
  if (typeof raw !== 'object' || raw === null) return;
  const candidate = raw as Cached;
  if (!candidate.payload || typeof candidate.payload.date !== 'string') return;

  // Only adopt it if it is still today's. Yesterday's is worse than refetching.
  if (candidate.payload.date !== utcDate()) return;

  cached = candidate;
  console.log(`[sface] restored mission ${candidate.payload.date} ${candidate.payload.ticker}`);
}

let persist: () => void = () => {};

/** Wired from index.ts so this module does not import the snapshot shape. */
export function onChange(handler: () => void): void {
  persist = handler;
}
