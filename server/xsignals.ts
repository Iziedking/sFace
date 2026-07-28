/**
 * CT Signals: who actually engages with you on crypto X.
 *
 * ## What this is for
 *
 * Clans are the weakest thing in the game because you pick one blind. You type
 * four characters and hope. The people you would actually want to fly with are
 * the ones who already reply to you, and nobody knows who those are off the top
 * of their head, because a timeline is not a memory.
 *
 * So this answers one question: of the accounts that engaged you this week,
 * which ones are already here, and what are they flying for.
 *
 * ## It reads public data, and only public data
 *
 * This was going to need the player's own OAuth scopes to read their notifs.
 * It does not. Replies and mentions are public posts, and X's recent search
 * returns them for any handle without a user token. So there is nothing to ask
 * permission for, nothing to store, and no access token in the loop at all.
 *
 * The competition rules prohibit "collection, storage or transmission of user
 * data without clear disclosure, lawful basis, and informed consent". The
 * posture that satisfies that most cleanly is not a consent dialog, it is
 * having nothing to consent to: this computes on the fly and returns. Nothing
 * is written to disk, no engagement graph is retained, and asking for the same
 * handle tomorrow re-reads X rather than serving yesterday's answer about a
 * person.
 *
 * ## On the paywall, plainly
 *
 * The deep read costs NIM. That is not DRM and it is not pretending to be:
 * this repo is MIT and public, so anybody can run it themselves for nothing.
 * What the payment does is keep the X API credit topped up, which is a real
 * bill that a real person pays. It is a tip jar with a feature attached, and
 * the screen says so rather than implying a lock that is not there.
 */

import * as profiles from './profiles';

const API = 'https://api.x.com/2';
const TIMEOUT_MS = 12_000;

/** Bursts per UTC day across all callers. A signal read is two searches. */
const MAX_BURSTS_PER_DAY = 120;

let bursts = 0;
let burstDay = '';

export interface Engager {
  handle: string;
  /** How many times they replied to or mentioned this handle this week. */
  touches: number;
  followers: number;
  /** Their sFace clan, when they are already playing. The point of the feature. */
  clanTag: string | null;
  /** True when they have a profile here at all. */
  playing: boolean;
}

export interface Signals {
  handle: string;
  /** Distinct accounts that engaged them in the window. */
  reach: number;
  /** Total replies and mentions counted. */
  touches: number;
  /** Ranked. Length depends on depth. */
  top: Engager[];
  /** Clans that more than one of their engagers already fly for. */
  clans: Array<{ tag: string; among: number }>;
  depth: 'glance' | 'full';
  /** How many more would be shown at full depth. Zero when already full. */
  moreAtFull: number;
}

export function xsignalsConfigured(): boolean {
  return Boolean(process.env.X_BEARER_TOKEN);
}

function withinBudget(): boolean {
  const day = new Date().toISOString().slice(0, 10);
  if (day !== burstDay) {
    burstDay = day;
    bursts = 0;
  }
  return bursts < MAX_BURSTS_PER_DAY;
}

async function search(query: string): Promise<{
  authors: Map<string, { handle: string; followers: number }>;
  counts: Map<string, number>;
} | null> {
  const bearer = process.env.X_BEARER_TOKEN;
  if (!bearer) return null;

  const url =
    `${API}/tweets/search/recent?query=${encodeURIComponent(query)}` +
    '&max_results=100&tweet.fields=author_id&expansions=author_id' +
    '&user.fields=username,public_metrics';

  try {
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${bearer}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      console.warn(`[sface] xsignals: search returned ${response.status}`);
      return null;
    }

    const body = (await response.json()) as {
      data?: Array<{ author_id?: unknown }>;
      includes?: { users?: Array<{ id?: unknown; username?: unknown; public_metrics?: { followers_count?: unknown } }> };
    };

    const authors = new Map<string, { handle: string; followers: number }>();
    for (const user of body.includes?.users ?? []) {
      if (typeof user.id !== 'string' || typeof user.username !== 'string') continue;
      authors.set(user.id, {
        handle: user.username.toLowerCase(),
        followers:
          typeof user.public_metrics?.followers_count === 'number'
            ? user.public_metrics.followers_count
            : 0,
      });
    }

    const counts = new Map<string, number>();
    for (const post of body.data ?? []) {
      if (typeof post.author_id !== 'string') continue;
      counts.set(post.author_id, (counts.get(post.author_id) ?? 0) + 1);
    }

    return { authors, counts };
  } catch (error) {
    console.warn('[sface] xsignals: search failed', error);
    return null;
  }
}

const DEPTH_SIZE = { glance: 3, full: 20 } as const;

/**
 * Who engaged this handle recently, ranked, with what they fly for.
 *
 * Returns null only when it could not read at all. An account nobody replied to
 * this week is a real answer and comes back with an empty list rather than an
 * error: "quiet week" is information.
 */
export async function readSignals(
  handle: string,
  depth: 'glance' | 'full',
): Promise<Signals | null> {
  const clean = handle.replace(/^@/, '').trim().toLowerCase();
  if (!/^[a-z0-9_]{1,15}$/.test(clean)) return null;
  if (!xsignalsConfigured() || !withinBudget()) return null;

  bursts += 2;

  /*
   * Two queries, because they catch different things. `to:` is a direct reply,
   * which is the strongest signal of engagement. A bare mention is weaker but
   * it is how quote posts and tags show up, and leaving it out would miss the
   * people who talk ABOUT somebody rather than AT them.
   *
   * Retweets are excluded: amplifying is not engaging, and a viral repost would
   * otherwise bury every real conversation under strangers.
   */
  const [replies, mentions] = await Promise.all([
    search(`to:${clean} -is:retweet`),
    search(`@${clean} -is:retweet -to:${clean}`),
  ]);

  if (!replies && !mentions) return null;

  const authors = new Map<string, { handle: string; followers: number }>();
  const counts = new Map<string, number>();

  for (const result of [replies, mentions]) {
    if (!result) continue;
    for (const [id, who] of result.authors) authors.set(id, who);
    for (const [id, n] of result.counts) counts.set(id, (counts.get(id) ?? 0) + n);
  }

  // Never rank somebody against themselves.
  for (const [id, who] of authors) {
    if (who.handle === clean) {
      counts.delete(id);
      authors.delete(id);
    }
  }

  /*
   * Match engagers to players by handle.
   *
   * Profile names are stored as "@handle" when an account is connected, so the
   * join is on that. Somebody playing under a generated pilot name simply does
   * not match, which is correct: they have not told us who they are on X.
   */
  const byHandle = new Map<string, { clanTag: string | null }>();
  for (const profile of profiles.all()) {
    const name = profile.name.startsWith('@') ? profile.name.slice(1).toLowerCase() : null;
    if (name) byHandle.set(name, { clanTag: profile.clanTag });
  }

  const ranked: Engager[] = [...counts.entries()]
    .map(([id, touches]) => {
      const who = authors.get(id);
      if (!who) return null;
      const player = byHandle.get(who.handle);
      return {
        handle: who.handle,
        touches,
        followers: who.followers,
        clanTag: player?.clanTag ?? null,
        playing: player !== undefined,
      };
    })
    .filter((e): e is Engager => e !== null)
    // Most touches first. Followers break ties, because between two people who
    // each replied once, the one more of crypto X listens to is the better lead.
    .sort((a, b) => b.touches - a.touches || b.followers - a.followers);

  /*
   * Clans worth knowing about.
   *
   * Only tags that more than one of their engagers already fly for. One person
   * in a clan is a coincidence; two or more is a reason to look at it, and this
   * is the entire point of the feature.
   */
  const tally = new Map<string, number>();
  for (const engager of ranked) {
    if (engager.clanTag) tally.set(engager.clanTag, (tally.get(engager.clanTag) ?? 0) + 1);
  }
  const clans = [...tally.entries()]
    .filter(([, among]) => among > 1)
    .sort((a, b) => b[1] - a[1])
    .map(([tag, among]) => ({ tag, among }));

  const size = DEPTH_SIZE[depth];

  return {
    handle: clean,
    reach: ranked.length,
    touches: [...counts.values()].reduce((total, n) => total + n, 0),
    top: ranked.slice(0, size),
    // Clan overlap is the paid half. A glance says how many there are without
    // saying which, which is an honest teaser rather than a fake one.
    clans: depth === 'full' ? clans : [],
    depth,
    moreAtFull: depth === 'full' ? 0 : Math.max(0, ranked.length - size),
  };
}

// The unlock ---------------------------------------------------------------

/**
 * Who has paid for a deep read today.
 *
 * Per UTC day, so the price buys a day rather than forever. Kept beside the
 * feature rather than on the profile because it is not part of anybody's
 * record: it expires, and a profile is the things that do not.
 *
 * REPORTED, NOT VERIFIED. The client sends the serialized transaction and we
 * take its word, exactly as challenge settlement does, because there is no
 * Nimiq node in this build to check it against. That is a real gap and it is
 * documented in the README rather than hidden. It matters less here than it
 * would elsewhere: the repo is MIT and public, so the deep read was never
 * behind a lock anybody had to break. See the header.
 */
interface Unlock {
  day: string;
  serializedTx: string;
  at: number;
}

const unlocks = new Map<string, Unlock>();

export function unlocked(deviceId: string): boolean {
  const held = unlocks.get(deviceId);
  return held !== undefined && held.day === new Date().toISOString().slice(0, 10);
}

export function grant(deviceId: string, serializedTx: string): void {
  unlocks.set(deviceId, {
    day: new Date().toISOString().slice(0, 10),
    serializedTx,
    at: Date.now(),
  });
  persist();
}

/** Drop yesterday's. Called by the housekeeping tick. */
export function pruneUnlocks(): void {
  const today = new Date().toISOString().slice(0, 10);
  for (const [id, held] of unlocks) {
    if (held.day !== today) unlocks.delete(id);
  }
}

export function serialise(): unknown {
  return [...unlocks.entries()].map(([id, held]) => ({ id, ...held }));
}

export function restore(raw: unknown): void {
  if (!Array.isArray(raw)) return;
  unlocks.clear();
  for (const item of raw as Array<Unlock & { id?: unknown }>) {
    if (typeof item?.id !== 'string' || typeof item.day !== 'string') continue;
    unlocks.set(item.id, {
      day: item.day,
      serializedTx: typeof item.serializedTx === 'string' ? item.serializedTx : '',
      at: typeof item.at === 'number' ? item.at : 0,
    });
  }
}

let persist: () => void = () => {};

export function onChange(handler: () => void): void {
  persist = handler;
}

/** What a deep read costs, in NIM. Small on purpose: it is a bill, not a rent. */
export const SIGNALS_PRICE_NIM = Number(process.env.SIGNALS_PRICE_NIM ?? 2);

/** Where the payment goes. Absent means the deep read is simply free. */
export function treasury(): string | null {
  return process.env.SFACE_TREASURY ?? null;
}
