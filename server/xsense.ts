/**
 * What crypto X is actually saying today, read once a day through Grok.
 *
 * This is the ground truth the mission is built on. The market gives us a
 * ticker and a chart; this gives us the story around it and the people in it.
 * Together the brief can say "SOL is down nine percent, here is what everyone
 * is arguing about, and here is who is in the wreck", which is a different
 * product from "here is a chart".
 *
 * Verified against docs.x.ai on 2026-07-28. Note that the older Live Search
 * API, with `search_parameters` and a `sources` array, is gone. The current
 * shape is agent tools on the Responses endpoint, and anything written from
 * memory of the old API will silently do nothing.
 *
 * ## What this asks for, and what it does not
 *
 * It asks for handles and for what was publicly said. It does not ask Grok for
 * pictures: a language model is the wrong place to source an image URL, since
 * it can produce a plausible one that points at nothing or, worse, at the
 * wrong person. Pictures come from X's own API in server/xusers.ts, keyed on
 * the handles this read returns, and the reasoning for showing them at all is
 * written out at the top of that file.
 *
 * ## Why it is wrapped so heavily
 *
 * It is a paid, slow, third-party call on the boot path of a game. So: one
 * call a day, a hard daily ceiling, exponential backoff on failure, a short
 * timeout, and a null return that the caller treats as "use the archetypes".
 * A Grok outage must cost the mission its flavour text, never its playability.
 */

import { resolve, type XCandidate } from './xposts';

const API_URL = 'https://api.x.ai/v1/responses';

/**
 * How many people are in the day's wreck.
 *
 * Raised from five. Five is a thin cast for a seven stage campaign and it made
 * the finale in particular feel small: the same handful, every stage, every
 * day. Eight is enough that the roster changes shape between days and that the
 * last stage can ask for more of them without asking for all of them.
 *
 * Every one is a real account with a real handle and picture, and the game
 * still shows nothing about them that is not linked to a post, so the cost of
 * a wider cast is a slightly longer read rather than a weaker claim.
 */
export const ROSTER_SIZE = 8;
const MODEL = process.env.XAI_MODEL ?? 'grok-4.5';
/**
 * Generous on purpose.
 *
 * This is a search-backed model call composing a headline, eight people, six
 * posts and up to four ongoing situations, and it runs once a day on a
 * background tick rather than on a request. Nobody is waiting on it, so the
 * only thing a short timeout buys is a mission with no story in it. Forty-five
 * seconds was not enough once the feed was added and every read aborted.
 */
const TIMEOUT_MS = 150_000;

/**
 * Hard ceiling on paid calls per UTC day. The mission is composed once a day,
 * so anything above a handful means something is looping, and a runaway loop
 * against a metered API is the expensive kind of bug.
 */
const MAX_CALLS_PER_DAY = 8;

const QUIRKS = ['heavy', 'talker', 'paranoid', 'skittish', 'mercenary'] as const;
const POST_KINDS = ['loud', 'call', 'warning', 'receipt', 'denial'] as const;
const THREAD_STATES = ['watching', 'escalating', 'resolved', 'cold'] as const;
export type Quirk = (typeof QUIRKS)[number];

export interface XRosterEntry {
  handle: string;
  displayName: string;
  line: string;
  quirk: Quirk;
  bounty: number;
  /**
   * Public profile picture, filled in by server/xusers.ts after this read.
   * Null when X did not serve one, which renders as a generated figure.
   */
  avatarUrl?: string | null;
}

/**
 * One thing worth reading, pulled off the timeline.
 *
 * Deliberately a summary and an attribution, never a verbatim quote. The point
 * is to tell somebody what happened and who to go and read, not to reprint
 * their post inside our product.
 */
export interface XPost {
  handle: string;
  /** What was said or what happened, in one dry sentence. */
  summary: string;
  /** Why it mattered today. */
  why: string;
  /** loud, call, warning, receipt, denial. Colours the chip. */
  kind: 'loud' | 'call' | 'warning' | 'receipt' | 'denial';
  /**
   * A link to the post being summarised. REQUIRED, and anything without one
   * is dropped before it reaches a screen.
   *
   * This is the single most important field in the file. Without it the model
   * will happily produce a fluent, plausible sentence attributing a view to a
   * real named person who never said it, and there is no way to tell from the
   * output that it did. That is not a quality problem, it is putting words in
   * somebody's mouth, and it is the thing the competition rules call
   * deceptive content.
   *
   * A citation does not make the model honest. It makes it CHECKABLE, which is
   * the only property that actually helps: a dead link is visible to anyone,
   * including us, including a judge.
   */
  url: string;
}

/**
 * A situation that is still running.
 *
 * The reason the feed is worth opening on a day you are not going to play: a
 * rug or an exploit is not one day's news, and following it to the end is
 * exactly what is hard to do by scrolling.
 */
export interface XThread {
  title: string;
  /** Where it stands right now. */
  status: string;
  /** watching, escalating, resolved, cold. */
  state: 'watching' | 'escalating' | 'resolved' | 'cold';
}

export interface XBrief {
  headline: string;
  /** -100 capitulation to 100 euphoria, as read from the timeline. */
  sentiment: number;
  topics: string[];
  roster: XRosterEntry[];
  /** The heavy posts of the day. Empty when the read found nothing worth it. */
  posts: XPost[];
  /** Situations still being followed. Empty is a normal, quiet day. */
  threads: XThread[];
}

export function xsenseConfigured(): boolean {
  return Boolean(process.env.XAI_API_KEY);
}

let callsToday = 0;
let callDay = '';
let failures = 0;
let nextAttemptAt = 0;

/**
 * Read today's crypto X. Returns null on absence, failure, budget, or garbage,
 * and the caller falls back to the committed archetypes.
 */
export async function readCryptoX(input: {
  date: string;
  ticker: string;
  changePct: number;
  fearGreed: number;
  /**
   * Real posts, already fetched from X. The model picks from these by index
   * and never writes a link. See server/xposts.ts for why that is structural
   * rather than a validation rule.
   */
  candidates?: readonly XCandidate[];
}): Promise<XBrief | null> {
  const key = process.env.XAI_API_KEY;
  if (!key) return null;

  if (callDay !== input.date) {
    callDay = input.date;
    callsToday = 0;
  }
  if (callsToday >= MAX_CALLS_PER_DAY) {
    console.warn(`[sface] xsense: daily call ceiling of ${MAX_CALLS_PER_DAY} reached`);
    return null;
  }
  if (Date.now() < nextAttemptAt) return null;

  callsToday++;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(requestBody(input)),
    });

    if (!response.ok) {
      throw new Error(`xAI returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }

    const brief = parseBrief(extractText(await response.json()), input.candidates ?? []);
    if (!brief) throw new Error('xAI returned a body we could not read');

    failures = 0;
    nextAttemptAt = 0;
    console.log(
      `[sface] xsense: "${brief.headline}" sentiment=${brief.sentiment} roster=${brief.roster
        .map((r) => r.handle)
        .join(',')}`,
    );
    return brief;
  } catch (error) {
    failures++;
    // Back off hard. This is a paid call and a flapping upstream is not worth
    // retrying at speed.
    const wait = Math.min(5 * 60_000 * 2 ** (failures - 1), 6 * 3_600_000);
    nextAttemptAt = Date.now() + wait;
    console.error(
      `[sface] xsense failed (${failures}), next attempt in ${Math.round(wait / 60_000)}m`,
      error instanceof Error ? error.message : error,
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The real posts, numbered, for the model to choose from.
 *
 * Verbatim text goes IN because the model has to read what was actually said
 * to judge it. Nothing verbatim comes back out: the schema only accepts a
 * number and a summary, so the player never sees a reproduced post.
 *
 * Newlines are flattened because a post containing one would otherwise break
 * the numbered list into what looks like extra items.
 */
function candidateBlock(candidates: readonly XCandidate[]): string[] {
  if (candidates.length === 0) {
    return [
      '',
      'No posts were retrievable today. Return an empty posts array. Do not describe any.',
    ];
  }

  return [
    '',
    'THE NUMBERED LIST. These are the real posts, already retrieved from X. Choose only from these.',
    ...candidates.map(
      (c) => `${c.index}. @${c.handle}${c.kind === 'repost' ? ' (repost)' : ''}: ${c.text.replace(/\s+/g, ' ')}`,
    ),
  ];
}

function requestBody(input: {
  date: string;
  ticker: string;
  changePct: number;
  fearGreed: number;
  candidates?: readonly XCandidate[];
}) {
  // Only today. Yesterday's argument is not today's mission.
  const from = input.date;

  return {
    model: MODEL,
    input: [
      {
        role: 'user',
        content: [
          'You are briefing a game that turns each day on crypto X into a rescue mission.',
          '',
          `Today is ${input.date}. The Fear and Greed index reads ${input.fearGreed}.`,
          '',
          /*
           * The ticker is deliberately NOT given.
           *
           * It used to be, and it poisoned everything downstream: handed an
           * obscure top-100 token and asked what X is discussing, the model
           * anchored on the token and produced confident attributed quotes
           * about it for real, named people who had never mentioned it. The
           * level comes from the market; the conversation has to come from the
           * conversation. They are two independent true things and joining
           * them invented a third that was false.
           */
          'Search X for what crypto is genuinely talking about today and answer with:',
          '',
          '1. headline: one sentence, present tense, plain language, no hype words and no exclamation marks. What is the story today. Under 120 characters.',
          '2. sentiment: an integer from -100 (capitulation) to 100 (euphoria), read from the timeline rather than from the price.',
          '3. topics: two to four short phrases naming what people are arguing about. Two or three words each.',
          '4. roster: exactly eight well known crypto accounts who were genuinely being discussed today. Mix the very large accounts with mid sized ones that were central to the day, so the list is not the same eight names every time.',
          '5. posts: the heaviest items from THE NUMBERED LIST BELOW, three to six of them. Choose what somebody who was away all day would want to know. Refer to each ONLY by its number. Do not write a handle, a link, a date or an id: they are already known.',
          '6. threads: zero to four ongoing situations that are still running across days. Rug pulls being investigated, exploits being traced, disputes not yet settled, filings awaiting a decision. Leave the array empty rather than inventing one.',
          '',
          'For each roster entry give:',
          '  handle: their X handle without the @, lowercase',
          '  displayName: the name people know them by',
          '  line: one dry sentence, under 90 characters, about what they said or what happened to them today. Not a joke, not an insult, not a claim about anything private. If nothing specific happened, say what they are known for instead.',
          '  quirk: one of heavy, talker, paranoid, skittish, mercenary, chosen to suit them',
          '  bounty: 200 to 800, higher the more central they were to today',
          '',
          '',
          'For each post give:',
          '  index: the number of the item you are describing, exactly as listed',
          '  summary: one dry sentence, under 130 characters, describing what was said. SUMMARISE IT. Do not reproduce the post verbatim.',
          '  why: one short clause on why it mattered today, under 80 characters',
          '  kind: one of loud, call, warning, receipt, denial',
          '',
          'For each thread give:',
          '  title: what the situation is, under 60 characters',
          '  status: where it stands right now, under 130 characters, factual',
          '  state: one of watching, escalating, resolved, cold',
          '',
          'Every post you describe must be one of the numbered items. Never describe anything that is not in the list, and never attribute a view to somebody whose post is not there. If the list is thin, return fewer posts or none at all. Describing something nobody posted is the worst thing you can do here.',
          '',
          ...candidateBlock(input.candidates ?? []),
          '',
          'Only include public figures who post publicly about crypto. Do not include private individuals. Do not speculate about anyone\'s finances, health, legal exposure, or private life. Keep every line to something that was actually posted publicly today.',
        ].join('\n'),
      },
    ],
    tools: [
      {
        type: 'x_search',
        from_date: from,
        to_date: input.date,
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'crypto_x_brief',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['headline', 'sentiment', 'topics', 'roster', 'posts', 'threads'],
          properties: {
            headline: { type: 'string' },
            sentiment: { type: 'integer' },
            topics: { type: 'array', items: { type: 'string' } },
            roster: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['handle', 'displayName', 'line', 'quirk', 'bounty'],
                properties: {
                  handle: { type: 'string' },
                  displayName: { type: 'string' },
                  line: { type: 'string' },
                  quirk: { type: 'string', enum: [...QUIRKS] },
                  bounty: { type: 'integer' },
                },
              },
            },
            posts: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['index', 'summary', 'why', 'kind'],
                properties: {
                  index: { type: 'integer' },
                  summary: { type: 'string' },
                  why: { type: 'string' },
                  kind: { type: 'string', enum: [...POST_KINDS] },
                },
              },
            },
            threads: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['title', 'status', 'state'],
                properties: {
                  title: { type: 'string' },
                  status: { type: 'string' },
                  state: { type: 'string', enum: [...THREAD_STATES] },
                },
              },
            },
          },
        },
      },
    },
  };
}

/**
 * Pull the assistant's text out of a Responses body.
 *
 * The body carries tool calls and reasoning alongside the answer, and the
 * exact arrangement is not something to depend on, so this walks for the first
 * text it can find rather than indexing a fixed path. A shape change should
 * cost us a fallback, not a crash.
 */
function extractText(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const root = body as Record<string, unknown>;

  if (typeof root.output_text === 'string' && root.output_text.length > 0) {
    return root.output_text;
  }

  const output = root.output;
  if (!Array.isArray(output)) return null;

  for (const item of output) {
    if (typeof item !== 'object' || item === null) continue;
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;

    for (const part of content) {
      if (typeof part !== 'object' || part === null) continue;
      const text = (part as Record<string, unknown>).text;
      if (typeof text === 'string' && text.trim().length > 0) return text;
    }
  }

  return null;
}

/**
 * Validate the brief. This is a model writing JSON, so it is a boundary like
 * any other: everything is checked, anything unusable is dropped, and a roster
 * that comes back short is simply short. The mission layer tops it up.
 */
export function parseBrief(
  text: string | null,
  candidates: readonly XCandidate[] = [],
): XBrief | null {
  if (!text) return null;

  let raw: unknown;
  try {
    // Models occasionally wrap JSON in a fence even when told not to.
    raw = JSON.parse(text.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, ''));
  } catch {
    return null;
  }

  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;

  const headline = typeof value.headline === 'string' ? value.headline.trim() : '';
  if (headline.length === 0) return null;

  const topics = Array.isArray(value.topics)
    ? value.topics
        .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        .map((t) => t.trim().slice(0, 32))
        .slice(0, 4)
    : [];

  const roster: XRosterEntry[] = [];
  const seen = new Set<string>();

  if (Array.isArray(value.roster)) {
    for (const item of value.roster) {
      if (typeof item !== 'object' || item === null) continue;
      const entry = item as Record<string, unknown>;

      const handle =
        typeof entry.handle === 'string'
          ? entry.handle.replace(/^@/, '').trim().toLowerCase()
          : '';
      // X handles are 1 to 15 of letters, digits and underscore. Anything else
      // is the model improvising and would render as a broken link.
      if (!/^[a-z0-9_]{1,15}$/.test(handle) || seen.has(handle)) continue;
      seen.add(handle);

      roster.push({
        handle,
        displayName: str(entry.displayName, 40) ?? `@${handle}`,
        line: str(entry.line, 110) ?? 'Still posting through it.',
        quirk: asQuirk(entry.quirk),
        bounty: clamp(Math.round(numberOf(entry.bounty) ?? 350), 200, 800),
      });

      if (roster.length === ROSTER_SIZE) break;
    }
  }

  /*
   * Posts and threads are validated exactly as hard as the roster.
   *
   * They are model output going onto a screen that presents itself as a news
   * feed, so anything malformed is dropped rather than shown. An empty feed on
   * a quiet day is honest; a feed with a half-parsed entry in it is not.
   */
  const posts: XPost[] = [];
  const seenIndex = new Set<number>();
  if (Array.isArray(value.posts)) {
    for (const item of value.posts) {
      if (typeof item !== 'object' || item === null) continue;
      const entry = item as Record<string, unknown>;

      /*
       * The index is the whole safety property.
       *
       * The handle, the link and the timestamp all come from the post X gave
       * us, never from the model. An index that was invented, repeated or out
       * of range resolves to nothing and the row simply does not exist.
       */
      const source = resolve(candidates, entry.index);
      const summary = str(entry.summary, 160);
      if (!source || !summary || seenIndex.has(source.index)) continue;
      seenIndex.add(source.index);

      posts.push({
        handle: source.handle,
        summary,
        why: str(entry.why, 100) ?? '',
        kind: POST_KINDS.includes(entry.kind as never) ? (entry.kind as XPost['kind']) : 'loud',
        url: source.url,
      });

      if (posts.length === 6) break;
    }
  }

  const threads: XThread[] = [];
  if (Array.isArray(value.threads)) {
    for (const item of value.threads) {
      if (typeof item !== 'object' || item === null) continue;
      const entry = item as Record<string, unknown>;

      const title = str(entry.title, 80);
      const status = str(entry.status, 160);
      if (!title || !status) continue;

      threads.push({
        title,
        status,
        state: THREAD_STATES.includes(entry.state as never)
          ? (entry.state as XThread['state'])
          : 'watching',
      });

      if (threads.length === 4) break;
    }
  }

  return {
    headline: headline.slice(0, 140),
    sentiment: clamp(Math.round(numberOf(value.sentiment) ?? 0), -100, 100),
    topics,
    roster,
    posts,
    threads,
  };
}

/*
 * postUrl() used to live here: it validated a URL the model wrote, checking
 * the host, the /status/ path and that the handle in the path matched the
 * handle being attributed. It is gone because the model no longer writes URLs
 * at all. It picks a numbered real post and server/xposts.ts builds the link
 * from X's own id, which makes a fabricated link impossible to express rather
 * than merely detectable. Do not reintroduce a model-written URL field.
 */

function str(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, max) : null;
}

function numberOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asQuirk(value: unknown): Quirk {
  return typeof value === 'string' && (QUIRKS as readonly string[]).includes(value)
    ? (value as Quirk)
    : 'talker';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export { MAX_CALLS_PER_DAY };
