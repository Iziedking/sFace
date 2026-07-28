/**
 * Real posts, from X itself.
 *
 * ## Why this file exists
 *
 * The Dispatch used to ask Grok what crypto X was posting and print the
 * answer. It produced fluent, confident, attributed statements for real named
 * people who had never said them, and there was nothing in the output that
 * revealed it. Requiring a citation caught it: the next read returned six
 * posts and every single one was dropped for having no verifiable link.
 *
 * So the division of labour is now fixed and it is the whole point of the
 * rebuild:
 *
 *   X supplies the FACTS.     Which posts exist, by whom, when, and what they
 *                             say. Fetched here, from X's own API.
 *   Grok supplies the JUDGEMENT. Which of them matter, what the mood is, what
 *                             is still unresolved.
 *
 * The model interprets. It never invents the facts.
 *
 * ## The structural guarantee
 *
 * Grok is handed the candidate posts with an index and is asked to return
 * indices. It is never asked for a URL, an id, a handle or a timestamp, so it
 * cannot produce one. We map the index back to the real post here and build
 * the link ourselves from data X gave us.
 *
 * That is strictly stronger than validating a URL the model wrote. A validator
 * can only reject a bad link it recognises; this makes a fabricated link
 * impossible to express in the first place. The worst a confused model can now
 * do is pick a real post and describe it oddly.
 */

const API = 'https://api.x.com/2';
const TIMEOUT_MS = 12_000;

/**
 * Hard ceiling on request bursts per UTC day.
 *
 * The read runs once a day and spends a handful of calls doing it. Anything
 * past this means something is looping, and a loop against a metered API is
 * the expensive kind of bug. Same reasoning as the ceilings in xsense.ts and
 * xusers.ts.
 */
const MAX_BURSTS_PER_DAY = 4;

/** How far back a post can be and still count as today's timeline. */
const WINDOW_HOURS = 24;

let bursts = 0;
let burstDay = '';

export interface XCandidate {
  /** Position in the list handed to the model. The only thing it returns. */
  index: number;
  handle: string;
  /** Verbatim, for the model to read. Never rendered to a player. */
  text: string;
  createdAt: string;
  /** Built here from X's own id. The model never sees or writes this. */
  url: string;
  /** Reposts and replies are down-weighted rather than dropped. */
  kind: 'post' | 'reply' | 'repost';
}

export function xpostsConfigured(): boolean {
  return Boolean(process.env.X_BEARER_TOKEN || (process.env.X_API_KEY && process.env.X_API_SECRET));
}

function token(): string | null {
  return process.env.X_BEARER_TOKEN ?? null;
}

function withinBudget(): boolean {
  const day = new Date().toISOString().slice(0, 10);
  if (day !== burstDay) {
    burstDay = day;
    bursts = 0;
  }
  return bursts < MAX_BURSTS_PER_DAY;
}

async function get(path: string): Promise<unknown | null> {
  const bearer = token();
  if (!bearer) return null;

  try {
    const response = await fetch(`${API}${path}`, {
      headers: { authorization: `Bearer ${bearer}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      console.warn(`[sface] xposts: ${path.split('?')[0]} returned ${response.status}`);
      return null;
    }
    return await response.json();
  } catch (error) {
    console.warn('[sface] xposts: request failed', error);
    return null;
  }
}

/** Numeric ids for a set of handles, keyed by lowercase handle. */
async function idsFor(handles: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const wanted = handles.filter((h) => /^[a-z0-9_]{1,15}$/.test(h)).slice(0, 100);
  if (wanted.length === 0) return out;

  const body = (await get(`/users/by?usernames=${wanted.join(',')}`)) as {
    data?: Array<{ id?: unknown; username?: unknown }>;
  } | null;

  for (const user of body?.data ?? []) {
    if (typeof user.id === 'string' && typeof user.username === 'string') {
      out.set(user.username.toLowerCase(), user.id);
    }
  }
  return out;
}

function fresh(createdAt: string, now: number): boolean {
  const at = Date.parse(createdAt);
  return Number.isFinite(at) && now - at <= WINDOW_HOURS * 3_600_000;
}

/**
 * Everything the roster actually posted in the last day.
 *
 * One call per account rather than a batch, because X has no endpoint that
 * returns several users' timelines at once. Five accounts is five calls, once
 * a day, which is why the burst ceiling is small rather than tight.
 */
export async function recentFrom(handles: readonly string[]): Promise<XCandidate[]> {
  if (!xpostsConfigured() || !withinBudget()) return [];
  bursts++;

  const ids = await idsFor(handles.map((h) => h.replace(/^@/, '').toLowerCase()));
  if (ids.size === 0) return [];

  const now = Date.now();
  const found: Omit<XCandidate, 'index'>[] = [];

  for (const [handle, id] of ids) {
    const body = (await get(
      `/users/${id}/tweets?max_results=20&tweet.fields=created_at,referenced_tweets` +
        '&exclude=replies',
    )) as {
      data?: Array<{
        id?: unknown;
        text?: unknown;
        created_at?: unknown;
        referenced_tweets?: Array<{ type?: unknown }>;
      }>;
    } | null;

    for (const post of body?.data ?? []) {
      if (typeof post.id !== 'string' || typeof post.text !== 'string') continue;
      if (typeof post.created_at !== 'string' || !fresh(post.created_at, now)) continue;

      const referenced = post.referenced_tweets?.[0]?.type;
      const kind =
        referenced === 'retweeted' ? 'repost' : referenced === 'replied_to' ? 'reply' : 'post';

      found.push({
        handle,
        text: post.text.slice(0, 400),
        createdAt: post.created_at,
        // Built from X's own id. This is the only place a link is made.
        url: `https://x.com/${handle}/status/${post.id}`,
        kind,
      });
    }
  }

  /*
   * Originals first, then newest.
   *
   * A timeline full of reposts tells you what somebody amplified, not what
   * they said, and "X reposted a thing" is a weak row in a feed. They are kept
   * rather than dropped because on a quiet day an amplification is still a
   * signal, they just lose every tie.
   */
  const rank = { post: 0, reply: 1, repost: 2 } as const;
  found.sort(
    (a, b) =>
      rank[a.kind] - rank[b.kind] || Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );

  const candidates = found.slice(0, 40).map((post, index) => ({ ...post, index }));
  console.log(`[sface] xposts: ${candidates.length} real posts from ${ids.size} accounts`);
  return candidates;
}

/**
 * Turn model-chosen indices back into real posts.
 *
 * The one function that closes the loop. An index the model made up, repeated,
 * or returned out of range resolves to nothing and the row disappears, which
 * is the same honest outcome as a post it could not source.
 */
export function resolve(
  candidates: readonly XCandidate[],
  index: unknown,
): XCandidate | null {
  if (typeof index !== 'number' || !Number.isInteger(index)) return null;
  return candidates.find((c) => c.index === index) ?? null;
}
