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

import {
  readCryptoX,
  xsenseConfigured,
  type XPost,
  type XRosterEntry,
  type XThread,
} from './xsense';
import { lookupAvatars } from './xusers';
import { recentFrom } from './xposts';
import { ResilientFetch } from './resilient-fetch';

// Native Node fetch, verified against the provider URLs listed above on
// 2026-08-10. One shared instance keeps circuit state per upstream origin.
const oracleFetch = new ResilientFetch();

export interface MissionStory {
  headline: string;
  sentiment: number;
  topics: string[];
  live: boolean;
  /** The heavy posts of the day, for the dispatch feed. */
  posts: XPost[];
  /** Situations still running across days. */
  threads: XThread[];
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
  /**
   * The ones still standing, biggest first. Allies on the last stage.
   *
   * Real rows from the same market call that finds the day's wreck, carried
   * through rather than described. The final stage is about the projects that
   * outlasted every cycle that killed something else, and the only honest way to
   * name them is by market cap on the day you play, from the same source the
   * rest of the mission comes from. Nothing here is a model's opinion of which
   * projects matter.
   */
  survivors: Survivor[];
  /**
   * The whole market, for the ending of the last stage.
   *
   * The campaign spends seven stages inside one bad day. The point it closes on
   * is that the bad day is small, and that only lands if the number is real and
   * current rather than a figure written into the copy months ago.
   */
  market: MarketSize | null;
}

export interface MarketSize {
  /** Total crypto market capitalisation in USD. */
  totalUsd: number;
  /** Its own 24 hour move, which is usually nothing like the wreck's. */
  changePct: number;
  /** Share held by the largest, as a percentage. */
  btcDominance: number;
  /** How many assets are tracked. A count of how much of this exists at all. */
  assets: number;
}

/** A project still in the top ten by market cap, with its own day attached. */
export interface Survivor {
  /** Upper case, e.g. BTC. */
  ticker: string;
  name: string;
  /** Place by market cap, 1 is the largest. */
  rank: number;
  /** Its own 24 hour change. Often green on a day the wreck is deep red. */
  changePct: number;
}

const TERRAIN_POINTS = 240;

/**
 * Accounts read every day, whatever the roster says.
 *
 * ## Why a fixed list exists at all
 *
 * The roster is whoever crypto X argued about that day. That is the right source
 * for the people in the wreck and the wrong one for the state of the market. On
 * a quiet day the argument is about a launch or a personality, and the Dispatch
 * comes back with nothing about the thing the game is premised on, which is that
 * crypto is having a bad year.
 *
 * These accounts post the other half consistently: exploits, liquidations, red
 * boards, the running total of what went wrong. Including them means the
 * Dispatch always has some of that to rank, and Grok still picks what matters
 * rather than being told.
 *
 * Short on purpose. Every handle is a request against a metered quota, and a
 * long standing list would crowd out the people the day was actually about.
 */
export const ALWAYS_READ = ['WatcherGuru'] as const;

/**
 * The roster plus the standing accounts, deduplicated.
 *
 * Case-insensitive, because X handles are. A duplicate here is a wasted call
 * against a metered API rather than a harmless repeat.
 */
export function readList(roster: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const handle of [...roster, ...ALWAYS_READ]) {
    const clean = handle.replace(/^@/, '').trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }

  return out;
}

export async function composeMission(): Promise<MissionPayload> {
  const date = new Date().toISOString().slice(0, 10);

  const [rows, fng, market] = await Promise.all([
    fetchMarket(),
    fetchFearGreed(),
    fetchMarketSize(),
  ]);
  const { worst, survivors } = rows;

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
  /*
   * Two reads, in order, and the order is the point.
   *
   * The first asks Grok who crypto X is actually arguing about today, which is
   * a judgement and the thing a model is good at. The second goes to X and
   * fetches what those accounts genuinely posted, which is a fact and the
   * thing a model must never be asked for. The third call hands those real
   * posts back to Grok to rank and summarise.
   *
   * Costed deliberately: it is three round trips once a day on a background
   * tick, and it is what stands between a news feed and a machine that invents
   * quotes about real people. See server/xposts.ts.
   */
  const cast = await readCryptoX({
    date,
    ticker: worst.symbol.toUpperCase(),
    changePct: worst.changePct,
    fearGreed: fng.value,
  });

  const candidates = cast ? await recentFrom(readList(cast.roster.map((r) => r.handle))) : [];

  // Only worth a second Grok call if X actually gave us something to rank.
  const brief =
    candidates.length > 0
      ? ((await readCryptoX({
          date,
          ticker: worst.symbol.toUpperCase(),
          changePct: worst.changePct,
          fearGreed: fng.value,
          candidates,
        })) ?? cast)
      : cast;

  if (!brief && xsenseConfigured()) {
    console.warn('[sface] mission composed without an X read, falling back to archetypes');
  }

  /*
   * Put a real face on each of them.
   *
   * Done here rather than inside the Grok read because a language model is the
   * wrong source for an image URL, and done after the roster is settled so it
   * is one lookup for the whole cast. It resolves to an empty map on any
   * failure, in which case every entry keeps a null picture and renders as the
   * generated figure it did before.
   *
   * Note that this runs AFTER the seed material is decided below only in
   * reading order: the fingerprint deliberately does not include the picture,
   * because a KOL changing their avatar mid-day must not invalidate every
   * in-flight challenge on today's seed.
   */
  const roster = brief?.roster ?? [];
  if (roster.length > 0) {
    const pictures = await lookupAvatars(roster.map((r) => r.handle));
    for (const entry of roster) {
      entry.avatarUrl = pictures.get(entry.handle) ?? null;
    }
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
    roster,
    story: brief
      ? {
          headline: brief.headline,
          sentiment: brief.sentiment,
          posts: brief.posts,
          threads: brief.threads,
          topics: brief.topics,
          live: true,
        }
      : null,
    survivors,
    market,
  };
}

/**
 * The size of the whole market.
 *
 * Its own call, and allowed to fail without taking the mission with it. The
 * ending reads better with it and still works without it, so a mission must
 * never be refused because one extra endpoint was slow.
 */
async function fetchMarketSize(): Promise<MarketSize | null> {
  try {
    const res = await oracleFetch.get('https://api.coingecko.com/api/v3/global');
    if (!res.ok) return null;

    const body = (await res.json()) as {
      data?: {
        total_market_cap?: Record<string, number>;
        market_cap_change_percentage_24h_usd?: number;
        market_cap_percentage?: Record<string, number>;
        active_cryptocurrencies?: number;
      };
    };

    const totalUsd = body.data?.total_market_cap?.usd;
    if (typeof totalUsd !== 'number' || totalUsd <= 0) return null;

    return {
      totalUsd,
      changePct: body.data?.market_cap_change_percentage_24h_usd ?? 0,
      btcDominance: body.data?.market_cap_percentage?.btc ?? 0,
      assets: body.data?.active_cryptocurrencies ?? 0,
    };
  } catch {
    return null;
  }
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

/**
 * How many of the largest projects become allies.
 *
 * Ten is enough that the last stage can gate several regions behind different
 * ones and still have spares, and few enough that every name on the list is one
 * a player recognises without being told who it is.
 */
const SURVIVOR_COUNT = 10;

/**
 * Is this row a pegged asset rather than a project that survived anything?
 *
 * Four of the largest ten by market cap are usually stablecoins or wrapped
 * deposits, and casting them as the ones that outlasted the cycle is nonsense:
 * a peg is engineered not to move, so it has not withstood anything. It also
 * ruins the one number the finale shows, since an ally whose day is always
 * exactly zero per cent says nothing about how the market held up.
 *
 * Detected from the data rather than from a list of names we maintain. A token
 * trading within a few per cent of a dollar and barely moving in a day is a peg,
 * and no opinion about which projects deserve to be there is involved. A real
 * project that happens to trade near a dollar is not excluded unless it is also
 * flat, which over a full day is vanishingly unlikely.
 */
function isPeg(price: number | null, changePct: number | null): boolean {
  if (typeof price !== 'number' || typeof changePct !== 'number') return false;
  return Math.abs(price - 1) < 0.05 && Math.abs(changePct) < 0.5;
}

/** The biggest 24-hour loser in the top 100 by market cap. Today's wreck. */
async function fetchMarket(): Promise<{ worst: Performer; survivors: Survivor[] }> {
  const url =
    'https://api.coingecko.com/api/v3/coins/markets' +
    '?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false';

  const res = await oracleFetch.get(url);
  if (!res.ok) throw new Error(`CoinGecko markets failed: ${res.status}`);

  const rows = (await res.json()) as Array<{
    id: string;
    symbol: string;
    name: string;
    current_price: number | null;
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

  /*
   * The survivors come off the ORIGINAL order, not the sorted one.
   *
   * CoinGecko returns the page already ranked by market cap, and sorting above
   * destroyed that. Taking the head of `rows` is what makes these the largest
   * projects rather than simply the ten that happened to be up today, which is a
   * different and much less interesting list.
   *
   * The day's wreck is excluded. It can be a top-ten name, and casting it as
   * both the disaster and the rescue party would be incoherent.
   */
  const survivors: Survivor[] = rows
    .filter((r) => r.id !== worst.id)
    .filter((r) => !isPeg(r.current_price, r.price_change_percentage_24h))
    .slice(0, SURVIVOR_COUNT)
    .map((r, index) => ({
      ticker: r.symbol.toUpperCase(),
      name: r.name,
      rank: index + 1,
      changePct: r.price_change_percentage_24h ?? 0,
    }));

  return {
    worst: {
      id: worst.id,
      symbol: worst.symbol,
      name: worst.name,
      changePct: worst.price_change_percentage_24h ?? 0,
    },
    survivors,
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

  const res = await oracleFetch.get(url);
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
  const res = await oracleFetch.get('https://api.alternative.me/fng/?limit=1');
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
