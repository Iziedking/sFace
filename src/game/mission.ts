/**
 * The daily mission: what the server sends, and what we do when it does not.
 *
 * The client validates the payload rather than trusting it. The server owns its
 * own copy of this shape in server/oracle.ts, and the two can drift. This
 * validator is what turns that drift into a loud, immediate offline fallback
 * instead of a level that generates wrong or a screen that renders NaN.
 *
 * When the market is unreachable we still play. The practice mission is
 * generated from the date so it is the same for everyone on the same day, and
 * it is labelled as practice everywhere it appears. A made-up ticker with a
 * made-up percentage would cost more than an honest empty state.
 */

import { Rng } from '../core/rng';
import { FACES, type FaceQuirk } from '../data/faces';

/** Must match TERRAIN_POINTS in server/oracle.ts or level geometry shifts. */
export const TERRAIN_POINTS = 240;

/**
 * One person worth pulling out of today's wreck.
 *
 * The roster is real: handles that were actually being talked about on crypto
 * X today, with a one-line reason drawn from what was actually said. That is
 * the ground truth the whole mission is built on, and it is why the brief can
 * name a person and a reason rather than a generic archetype.
 *
 * `avatarUrl` is normally null and the character is drawn with a generated
 * face derived from the handle. Real profile pictures are only rendered for
 * the player's own connected account, where consent is explicit. See the note
 * in server/xsense.ts.
 */
export interface RosterEntry {
  /** Without the @. Lowercased. */
  handle: string;
  displayName: string;
  /** One dry line about why they are in the wreck today. */
  line: string;
  /** Which rescue quirk they get. Same five behaviours as before. */
  quirk: FaceQuirk;
  /** Louder the day, bigger the bounty. */
  bounty: number;
  /** Null unless a real picture is explicitly configured. */
  avatarUrl: string | null;
}

/** One thing worth reading off today's timeline. */
export interface DispatchPost {
  handle: string;
  summary: string;
  why: string;
  kind: 'loud' | 'call' | 'warning' | 'receipt' | 'denial';
  /** The post being summarised. Required; unsourced entries never get here. */
  url: string;
}

/** A situation still running across days. */
export interface DispatchThread {
  title: string;
  status: string;
  state: 'watching' | 'escalating' | 'resolved' | 'cold';
}

/** Today's crypto X story, when we could read it. */
export interface MissionStory {
  /** One line, present tense, no hype. Shown on the brief. */
  headline: string;
  /** -100 fear to 100 euphoria, as read from the timeline. */
  sentiment: number;
  /** What people are actually arguing about. Two to four short phrases. */
  topics: string[];
  /** True when this came from a live read, false when it is the fallback. */
  live: boolean;
  /** The heavy posts of the day. Empty on a quiet day or a failed read. */
  posts: DispatchPost[];
  /** Situations still being followed. Empty is normal. */
  threads: DispatchThread[];
}

export interface DailyMission {
  /** YYYY-MM-DD in UTC. */
  date: string;
  /** Every client feeds this into the RNG. Identical runs come from it. */
  seed: string;
  ticker: string;
  coinName: string;
  /** 24-hour change, negative for a drop. Zero on a practice mission. */
  changePct: number;
  /** Normalised chart, 0 to 1, oldest first. This is the ground. */
  terrain: number[];
  /** Fear and Greed, 0 to 100. */
  fearGreed: number;
  fearLabel: string;
  /** 1 easy to 5 brutal. */
  difficulty: number;
  bountyMultiplier: number;
  /** False when this came from the fallback, not the market. Never hide this. */
  live: boolean;
  /** Who is in the wreck today. Never empty: falls back to the archetypes. */
  roster: RosterEntry[];
  /** What crypto X is saying, or null when we could not read it. */
  story: MissionStory | null;
  /**
   * The largest projects still standing, biggest first. Allies on stage seven.
   *
   * Real market rows, never a curated opinion of which projects count. Empty is
   * a normal state on a fallback mission and the last stage handles it.
   */
  survivors: Survivor[];
  /** The size of the whole market, for the campaign's ending. Null if unknown. */
  market: MarketSize | null;
}

/** How big crypto is today, from the same source as everything else here. */
export interface MarketSize {
  totalUsd: number;
  changePct: number;
  btcDominance: number;
  assets: number;
}

/** A project in the top ten by market cap, with its own day attached. */
export interface Survivor {
  ticker: string;
  name: string;
  /** Place by market cap, 1 is the largest. */
  rank: number;
  changePct: number;
}

/*
 * Nothing in this file reads the environment, and that is deliberate.
 *
 * The service imports it to rebuild a level from a seed, so it has to stay
 * importable from Node: types, parsing and the fallback only. The fetch that
 * used to live here now sits in net/mission.ts, which is client-only. See the
 * header of that file for the bug that separation exists to prevent.
 */

/** The market size, or null. Optional everywhere it is read. */
function parseMarket(raw: unknown): MarketSize | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;

  const totalUsd = num(value.totalUsd);
  if (totalUsd === null || totalUsd <= 0) return null;

  return {
    totalUsd,
    changePct: num(value.changePct) ?? 0,
    btcDominance: num(value.btcDominance) ?? 0,
    assets: num(value.assets) ?? 0,
  };
}

/**
 * The surviving projects, validated.
 *
 * Anything malformed drops out rather than failing the mission: a bad row costs
 * the last stage one ally, while refusing the whole payload would cost every
 * player their day over a field only one stage reads.
 */
function parseSurvivors(raw: unknown): Survivor[] {
  if (!Array.isArray(raw)) return [];

  const out: Survivor[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const value = entry as Record<string, unknown>;

    const ticker = str(value.ticker);
    const name = str(value.name);
    const rank = num(value.rank);
    const changePct = num(value.changePct);
    if (!ticker || !name || rank === null || changePct === null) continue;

    out.push({ ticker: ticker.toUpperCase().slice(0, 8), name: name.slice(0, 40), rank, changePct });
  }
  return out;
}

/**
 * Validate a payload off the wire. Anything unexpected returns null and we take
 * the fallback, because a half-valid mission produces a level that silently
 * does not match the one a challenger played.
 */
export function parseMission(raw: unknown): DailyMission | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;

  const terrain = value.terrain;
  if (!Array.isArray(terrain) || terrain.length !== TERRAIN_POINTS) return null;
  if (!terrain.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;

  const date = str(value.date);
  const seed = str(value.seed);
  const ticker = str(value.ticker);
  if (!date || !seed || !ticker) return null;

  const fearGreed = num(value.fearGreed);
  const difficulty = num(value.difficulty);
  if (fearGreed === null || difficulty === null) return null;

  return {
    date,
    seed,
    ticker,
    coinName: str(value.coinName) ?? ticker,
    changePct: num(value.changePct) ?? 0,
    // Clamp rather than reject. A chart point slightly outside 0 to 1 is a
    // rounding artefact, not a corrupt payload, and it must not escape into
    // the terrain where it would put ground off screen.
    terrain: terrain.map((n) => Math.min(1, Math.max(0, n))),
    fearGreed: clamp(fearGreed, 0, 100),
    fearLabel: str(value.fearLabel) ?? 'Unknown',
    difficulty: clamp(Math.round(difficulty), 1, 5),
    bountyMultiplier: clamp(num(value.bountyMultiplier) ?? 1, 1, 3),
    live: true,
    roster: parseRoster(value.roster),
    story: parseStory(value.story),
    survivors: parseSurvivors(value.survivors),
    market: parseMarket(value.market),
  };
}

/**
 * The roster off the wire. Falls back to the archetypes rather than returning
 * empty, because a level with nobody to rescue is not a level. The count is
 * fixed so the seeded layout places the same number of people every day.
 */
export function parseRoster(raw: unknown): RosterEntry[] {
  if (!Array.isArray(raw)) return fallbackRoster();

  const entries: RosterEntry[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const value = item as Record<string, unknown>;

    const handle = str(value.handle)?.replace(/^@/, '').toLowerCase();
    if (!handle || !/^[a-z0-9_]{1,15}$/.test(handle)) continue;

    entries.push({
      handle,
      displayName: str(value.displayName) ?? `@${handle}`,
      line: str(value.line) ?? 'Still here.',
      quirk: asQuirk(value.quirk),
      bounty: clamp(num(value.bounty) ?? 300, 100, 900),
      // Only ever populated when the service was explicitly configured to.
      avatarUrl: httpsUrl(value.avatarUrl),
    });

    if (entries.length === FACES.length) break;
  }

  // Top up from the archetypes so the level always holds the same headcount.
  const fallback = fallbackRoster();
  while (entries.length < FACES.length) {
    const filler = fallback[entries.length];
    if (!filler) break;
    entries.push(filler);
  }

  return capHeavy(entries);
}

/**
 * At most one person in the level is heavy.
 *
 * ## Why the roster cannot be trusted with this
 *
 * The quirk comes from a model asked to pick one that suits the person, and
 * nothing stopped it answering "heavy" for half the cast. Heavy is not a
 * flavour note: every heavy person being carried takes a slice of the ship's
 * thrust, and thrust divided by drag is the ship's top speed. Four of them and
 * the ship runs at its floor for the rest of the run.
 *
 * The nastiest part is that it gets worse the better you play. Rescue nobody
 * and the ship is fine; rescue everyone, which is the entire point of the game,
 * and it wades. Reported as the ship dragging with the whole chain in tow, and
 * that is exactly what it was.
 *
 * One is the right number. The Exchange King being a real cost to carry is a
 * decision worth making once in a level. Everybody being a cost is a tax.
 *
 * Demoted rather than dropped: the person stays in the level, they just stop
 * being an anchor. Deterministic, since the first in roster order keeps it and
 * both sides of a contest parse the same list.
 */
function capHeavy(entries: RosterEntry[]): RosterEntry[] {
  let seen = false;
  return entries.map((entry) => {
    if (entry.quirk !== 'heavy') return entry;
    if (seen) return { ...entry, quirk: 'talker' as const };
    seen = true;
    return entry;
  });
}

function parseStory(raw: unknown): MissionStory | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;

  const headline = str(value.headline);
  if (!headline) return null;

  const topics = Array.isArray(value.topics)
    ? value.topics.filter((t): t is string => typeof t === 'string' && t.length > 0).slice(0, 4)
    : [];

  return {
    headline: headline.slice(0, 140),
    sentiment: clamp(num(value.sentiment) ?? 0, -100, 100),
    topics,
    live: value.live === true,
    posts: parsePosts(value.posts),
    threads: parseThreads(value.threads),
  };
}

const POST_KINDS = ['loud', 'call', 'warning', 'receipt', 'denial'] as const;
const THREAD_STATES = ['watching', 'escalating', 'resolved', 'cold'] as const;

/**
 * The feed off the wire.
 *
 * Checked as hard as everything else that crosses this boundary, and then
 * some: this is the one screen that presents itself as news, so an entry that
 * does not parse is dropped rather than shown half-formed. An empty feed is
 * honest. A feed with a broken row in it is not.
 */
function parsePosts(raw: unknown): DispatchPost[] {
  if (!Array.isArray(raw)) return [];

  const out: DispatchPost[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const value = item as Record<string, unknown>;

    const handle = str(value.handle)?.replace(/^@/, '').toLowerCase() ?? '';
    const summary = str(value.summary);
    const url = postUrl(value.url, handle);

    // Checked again on this side of the wire. A summary attributed to a real
    // person with nothing to check it against does not go on a screen.
    if (!/^[a-z0-9_]{1,15}$/.test(handle) || !summary || !url) continue;

    const kind = POST_KINDS.find((k) => k === value.kind) ?? 'loud';
    out.push({
      handle,
      summary: summary.slice(0, 160),
      why: str(value.why)?.slice(0, 100) ?? '',
      kind,
      url,
    });
    if (out.length === 6) break;
  }
  return out;
}

/** Same shape check the service does, because this side must not trust it. */
function postUrl(raw: unknown, handle: string): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    if (!['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(url.hostname)) {
      return null;
    }
    const match = /^\/([A-Za-z0-9_]{1,15})\/status\/(\d{5,25})/.exec(url.pathname);
    if (!match || (match[1] ?? '').toLowerCase() !== handle) return null;
    return `https://x.com/${match[1]}/status/${match[2]}`;
  } catch {
    return null;
  }
}

function parseThreads(raw: unknown): DispatchThread[] {
  if (!Array.isArray(raw)) return [];

  const out: DispatchThread[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const value = item as Record<string, unknown>;

    const title = str(value.title);
    const status = str(value.status);
    if (!title || !status) continue;

    const state = THREAD_STATES.find((s) => s === value.state) ?? 'watching';
    out.push({ title: title.slice(0, 80), status: status.slice(0, 160), state });
    if (out.length === 4) break;
  }
  return out;
}

/** The original fictional archetypes. Safe, funny, and always available. */
export function fallbackRoster(): RosterEntry[] {
  return FACES.map((face) => ({
    handle: face.id,
    displayName: face.name,
    line: face.line,
    quirk: face.quirk,
    bounty: face.bounty,
    avatarUrl: null,
  }));
}

const QUIRKS: readonly FaceQuirk[] = [
  'heavy',
  'talker',
  'paranoid',
  'skittish',
  'mercenary',
];

function asQuirk(value: unknown): FaceQuirk {
  return typeof value === 'string' && (QUIRKS as readonly string[]).includes(value)
    ? (value as FaceQuirk)
    : 'talker';
}

/**
 * Only https, and only a host we expect to serve pictures. A URL off the wire
 * that ends up in an <img> src is a request the player's device makes, so it
 * does not get to be an arbitrary endpoint.
 */
function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    const allowed = ['pbs.twimg.com', 'abs.twimg.com'];
    return allowed.includes(url.hostname) ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * A playable mission with no network. Same for everyone on the same UTC day,
 * because it is seeded from the date, so challenges still work offline.
 */
export function practiceMission(date = utcDate()): DailyMission {
  const seed = `practice:${date}`;
  const rng = new Rng(seed);

  // A random walk with a downward bias, because the premise is a bad day.
  const raw: number[] = [];
  let level = 0.75;
  for (let i = 0; i < TERRAIN_POINTS; i++) {
    level += rng.range(-0.055, 0.045);
    level = clamp(level, 0.05, 0.95);
    raw.push(level);
  }

  const min = Math.min(...raw);
  const span = Math.max(...raw) - min || 1;

  return {
    date,
    seed,
    ticker: 'PRACTICE',
    coinName: 'Practice run',
    changePct: 0,
    terrain: raw.map((n) => (n - min) / span),
    fearGreed: 50,
    fearLabel: 'Neutral',
    difficulty: 3,
    bountyMultiplier: 1,
    live: false,
    roster: fallbackRoster(),
    story: null,
    // A practice day has no market behind it, so it has no survivors either.
    // Stage seven falls back to its own roster of names when this is empty.
    survivors: [],
    market: null,
  };
}

export function utcDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
