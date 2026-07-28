/**
 * The daily mission oracle.
 *
 * Once a day this pulls the real market and composes one mission payload that
 * every player in the world receives. The day's worst performer becomes the
 * level, its chart becomes the terrain, and the Fear and Greed index sets the
 * difficulty.
 *
 * Two free APIs, no keys:
 *   CoinGecko markets:  https://api.coingecko.com/api/v3/coins/markets
 *   CoinGecko chart:    https://api.coingecko.com/api/v3/coins/{id}/market_chart
 *   Fear and Greed:     https://api.alternative.me/fng/
 *
 * VERIFY both endpoints before wiring. CoinGecko rate-limits the free tier
 * hard, which is exactly why this runs once a day and caches, not per request.
 */

import { readCryptoX, xsenseConfigured, type XRosterEntry } from './xsense';

export interface MissionStory {
  headline: string;
  sentiment: number;
  topics: string[];
  live: boolean;
}

export interface MissionPayload {
  /** YYYY-MM-DD in UTC. Also the cache key. */
  date: string;
  /** Seed string every client feeds into the RNG. Identical runs come from this. */
  seed: string;
  ticker: string;
  coinName: string;
  /** 24-hour change, negative for a drop. */
  changePct: number;
  /** Normalised chart points, 0 to 1 on both axes, oldest first. Terrain. */
  terrain: number[];
  /** Fear and Greed, 0 to 100. */
  fearGreed: number;
  fearLabel: string;
  /** Derived difficulty, 1 easy to 5 brutal. */
  difficulty: number;
  /** Bounty multiplier. Fear pays better because fear is harder. */
  bountyMultiplier: number;
  /** Who is in the wreck today, read off crypto X. Empty when unavailable. */
  roster: XRosterEntry[];
  /** What crypto X is saying, or null when we could not read it. */
  story: MissionStory | null;
}

const TERRAIN_POINTS = 240;

export async function composeMission(): Promise<MissionPayload> {
  const date = new Date().toISOString().slice(0, 10);

  const [worst, fng] = await Promise.all([
    fetchWorstPerformer(),
    fetchFearGreed(),
  ]);

  const terrain = await fetchTerrain(worst.id);
  const difficulty = difficultyFromFear(fng.value);

  /*
   * Read crypto X for today's story and roster.
   *
   * Deliberately awaited rather than raced with the rest: this runs once a day
   * on a cron-like tick, not on a request, so a slow read costs nothing a
   * player can feel. It returns null on absence, failure or budget, and the
   * client tops the roster up from the committed archetypes, so a missing key
   * or a Grok outage produces a mission with less flavour rather than no
   * mission.
   */
  const brief = await readCryptoX({
    date,
    ticker: worst.symbol.toUpperCase(),
    changePct: worst.changePct,
    fearGreed: fng.value,
  });

  if (!brief && xsenseConfigured()) {
    console.warn('[sface] mission composed without an X read, falling back to archetypes');
  }

  return {
    date,
    /*
     * The seed encodes the day, the market and the cast, so it is reproducible
     * and auditable: anyone can check that today's level came from today's
     * data.
     *
     * The roster fingerprint is not decoration. Who is in the wreck decides
     * which rescue quirk lands where, and a quirk is gameplay. Two players on
     * the same seed but different rosters would be playing measurably
     * different levels while the app insisted the bet was fair. Folding the
     * cast into the seed makes any change to it visible as a different seed,
     * which the challenge guard already refuses to cross.
     */
    seed:
      `${date}:${worst.symbol}:${worst.changePct.toFixed(2)}:fng${fng.value}` +
      `:x${rosterFingerprint(brief?.roster ?? [])}`,
    ticker: worst.symbol.toUpperCase(),
    coinName: worst.name,
    changePct: worst.changePct,
    terrain,
    fearGreed: fng.value,
    fearLabel: fng.label,
    difficulty,
    // Extreme fear means a harder run, so it pays more. The market sets the purse.
    bountyMultiplier: 1 + (5 - difficulty === 0 ? 0.5 : (difficulty - 1) * 0.15),
    roster: brief?.roster ?? [],
    story: brief
      ? {
          headline: brief.headline,
          sentiment: brief.sentiment,
          topics: brief.topics,
          live: true,
        }
      : null,
  };
}

/**
 * A short, stable fingerprint of the cast. Order matters, because order is
 * what the seeded shuffle consumes. Not a hash for security, just a cheap way
 * to make a changed roster produce a changed seed.
 */
function rosterFingerprint(roster: readonly XRosterEntry[]): string {
  if (roster.length === 0) return 'none';

  const material = roster.map((r) => `${r.handle}:${r.quirk}:${r.bounty}`).join('|');

  let h = 2166136261;
  for (let i = 0; i < material.length; i++) {
    h ^= material.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

interface Performer {
  id: string;
  symbol: string;
  name: string;
  changePct: number;
}

/** The biggest 24-hour loser in the top 100 by market cap. Today's wreck. */
async function fetchWorstPerformer(): Promise<Performer> {
  const url =
    'https://api.coingecko.com/api/v3/coins/markets' +
    '?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false';

  const res = await fetch(url);
  if (!res.ok) throw new Error(`CoinGecko markets failed: ${res.status}`);

  const rows = (await res.json()) as Array<{
    id: string;
    symbol: string;
    name: string;
    price_change_percentage_24h: number | null;
  }>;

  const ranked = rows
    .filter((r) => typeof r.price_change_percentage_24h === 'number')
    .sort(
      (a, b) =>
        (a.price_change_percentage_24h ?? 0) - (b.price_change_percentage_24h ?? 0),
    );

  const worst = ranked[0];
  if (!worst) throw new Error('No usable market rows returned.');

  return {
    id: worst.id,
    symbol: worst.symbol,
    name: worst.name,
    changePct: worst.price_change_percentage_24h ?? 0,
  };
}

/**
 * The coin's last 24 hours, normalised to 0 to 1 and resampled to a fixed
 * length. This becomes the ground the player flies over, so it must be the same
 * length every day or the level geometry shifts under the seed.
 */
async function fetchTerrain(coinId: string): Promise<number[]> {
  const url =
    `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(coinId)}` +
    '/market_chart?vs_currency=usd&days=1';

  const res = await fetch(url);
  if (!res.ok) throw new Error(`CoinGecko chart failed: ${res.status}`);

  const body = (await res.json()) as { prices: Array<[number, number]> };
  const prices = body.prices.map(([, p]) => p);
  if (prices.length === 0) throw new Error('Empty price series.');

  const resampled = resample(prices, TERRAIN_POINTS);
  const min = Math.min(...resampled);
  const max = Math.max(...resampled);
  const span = max - min || 1;

  return resampled.map((p) => (p - min) / span);
}

/** Linear resample so the terrain is always the same number of points. */
function resample(values: number[], count: number): number[] {
  if (values.length === count) return values;
  const out: number[] = [];
  const step = (values.length - 1) / (count - 1);
  for (let i = 0; i < count; i++) {
    const pos = i * step;
    const lo = Math.floor(pos);
    const hi = Math.min(lo + 1, values.length - 1);
    const t = pos - lo;
    out.push(values[lo] * (1 - t) + values[hi] * t);
  }
  return out;
}

interface FearGreed {
  value: number;
  label: string;
}

async function fetchFearGreed(): Promise<FearGreed> {
  const res = await fetch('https://api.alternative.me/fng/?limit=1');
  if (!res.ok) throw new Error(`Fear and Greed failed: ${res.status}`);

  const body = (await res.json()) as {
    data: Array<{ value: string; value_classification: string }>;
  };
  const row = body.data?.[0];
  if (!row) throw new Error('No Fear and Greed row.');

  return {
    value: Number.parseInt(row.value, 10),
    label: row.value_classification,
  };
}

/**
 * Fear runs the level. Low index means extreme fear, which means more attackers,
 * faster fire, thicker fog, and a bigger bounty. The market decides how hard
 * today is, which is the entire point of the game.
 */
function difficultyFromFear(fng: number): number {
  if (fng <= 20) return 5; // extreme fear
  if (fng <= 40) return 4; // fear
  if (fng <= 60) return 3; // neutral
  if (fng <= 80) return 2; // greed
  return 1; // extreme greed
}
