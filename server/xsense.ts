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
 * ## What this deliberately does not do
 *
 * It asks for handles and for what was publicly said. It does not ask for,
 * receive, or store profile pictures, and the roster it returns is rendered as
 * a generated character derived from the handle rather than as a photograph of
 * a real person. Naming a public figure and quoting what they publicly said is
 * ordinary; putting their face on a game character in a commercial submission
 * is a likeness question nobody needs. The player's own avatar is different:
 * they connected the account themselves, and that path is in server/xauth.ts.
 *
 * ## Why it is wrapped so heavily
 *
 * It is a paid, slow, third-party call on the boot path of a game. So: one
 * call a day, a hard daily ceiling, exponential backoff on failure, a short
 * timeout, and a null return that the caller treats as "use the archetypes".
 * A Grok outage must cost the mission its flavour text, never its playability.
 */

const API_URL = 'https://api.x.ai/v1/responses';
const MODEL = process.env.XAI_MODEL ?? 'grok-4.5';
const TIMEOUT_MS = 45_000;

/**
 * Hard ceiling on paid calls per UTC day. The mission is composed once a day,
 * so anything above a handful means something is looping, and a runaway loop
 * against a metered API is the expensive kind of bug.
 */
const MAX_CALLS_PER_DAY = 8;

const QUIRKS = ['heavy', 'talker', 'paranoid', 'skittish', 'mercenary'] as const;
export type Quirk = (typeof QUIRKS)[number];

export interface XRosterEntry {
  handle: string;
  displayName: string;
  line: string;
  quirk: Quirk;
  bounty: number;
}

export interface XBrief {
  headline: string;
  /** -100 capitulation to 100 euphoria, as read from the timeline. */
  sentiment: number;
  topics: string[];
  roster: XRosterEntry[];
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

    const brief = parseBrief(extractText(await response.json()));
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

function requestBody(input: {
  date: string;
  ticker: string;
  changePct: number;
  fearGreed: number;
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
          `Today is ${input.date}. The worst performer in the top 100 is ${input.ticker}, down ${Math.abs(
            input.changePct,
          ).toFixed(1)} percent. The Fear and Greed index reads ${input.fearGreed}.`,
          '',
          'Search X for what crypto is actually talking about today and answer with:',
          '',
          '1. headline: one sentence, present tense, plain language, no hype words and no exclamation marks. What is the story today. Under 120 characters.',
          '2. sentiment: an integer from -100 (capitulation) to 100 (euphoria), read from the timeline rather than from the price.',
          '3. topics: two to four short phrases naming what people are arguing about. Two or three words each.',
          '4. roster: exactly five well known crypto accounts who were genuinely being discussed today.',
          '',
          'For each roster entry give:',
          '  handle: their X handle without the @, lowercase',
          '  displayName: the name people know them by',
          '  line: one dry sentence, under 90 characters, about what they said or what happened to them today. Not a joke, not an insult, not a claim about anything private. If nothing specific happened, say what they are known for instead.',
          '  quirk: one of heavy, talker, paranoid, skittish, mercenary, chosen to suit them',
          '  bounty: 200 to 800, higher the more central they were to today',
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
          required: ['headline', 'sentiment', 'topics', 'roster'],
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
export function parseBrief(text: string | null): XBrief | null {
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

      if (roster.length === 5) break;
    }
  }

  return {
    headline: headline.slice(0, 140),
    sentiment: clamp(Math.round(numberOf(value.sentiment) ?? 0), -100, 100),
    topics,
    roster,
  };
}

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
