/*
 * Anonymous usage counting for NIM Atlas.
 *
 * The competition scores "real usage" at 15 points and asks builders to get
 * real people to use the app. We could not previously report a single number,
 * so this exists to make an honest one available.
 *
 * It is a **funnel, not a hit counter**. "1,400 page views" says nothing a
 * judge can trust; "31 people played, 19 finished a chapter, 11 completed a
 * real verification" is a claim that survives being asked about. The funnel
 * also fails honestly: every stage is a subset of the one above it, so it
 * cannot be inflated by reloading.
 *
 * Privacy, against docs/privacy.md, which already permits a session actor id,
 * aggregate progress and bounded operational events:
 *
 * - The server stores a **hash** of the client's session id, never the id.
 * - No IP address, user agent, wallet address or any other identifier is
 *   accepted or retained by this module. The event shape below is the entire
 *   surface, and unknown fields are refused rather than ignored.
 * - Sessions are capped and evicted oldest-first, so the file cannot grow
 *   without bound and old participation ages out.
 *
 * This module is pure so both the server service and its tests fold the same
 * reducer. The server owns hashing, clock and storage.
 */

export const ATLAS_USAGE_EVENTS = ['session-start', 'chapter-start', 'chapter-complete', 'payment-verified', 'payment-refused'] as const;
export type AtlasUsageEventName = (typeof ATLAS_USAGE_EVENTS)[number];

export const ATLAS_USAGE_CHAPTERS = 7;
/** Enough for a cycle at hackathon scale, small enough to stay a readable file. */
export const ATLAS_USAGE_MAX_SESSIONS = 5000;
/** One session cannot contribute more than this, so a stuck client cannot skew a day. */
export const ATLAS_USAGE_MAX_EVENTS_PER_SESSION = 400;

export interface AtlasUsageEvent {
  readonly name: AtlasUsageEventName;
  /** Already hashed by the server. Never the raw client id. */
  readonly session: string;
  /** 0-6, required for the chapter events and refused otherwise. */
  readonly chapter?: number;
  /** 'phone' | 'desktop', a coarse self-declared hint. Not a fingerprint. */
  readonly device?: AtlasUsageDevice;
  readonly at: number;
}

export type AtlasUsageDevice = 'phone' | 'desktop';

export interface AtlasUsageSession {
  firstDay: string;
  lastDay: string;
  days: number;
  events: number;
  device: AtlasUsageDevice | null;
  chaptersStarted: number[];
  chaptersCompleted: number[];
  verified: number;
  refused: number;
}

export interface AtlasUsageState {
  version: 1;
  sessions: Record<string, AtlasUsageSession>;
  days: Record<string, { sessions: number; events: number }>;
  rejected: number;
}

export interface AtlasUsageSummary {
  /** Sessions that reached the app at all. */
  reach: number;
  /** Sessions that started at least one chapter. Reloading does not count. */
  played: number;
  /** Sessions that completed at least one chapter. */
  completed: number;
  /** Sessions that completed at least one real payment verification. */
  verified: number;
  /** Sessions seen on more than one day. This is the repeat-value evidence. */
  returning: number;
  /** Refusals are counted deliberately: the app refusing a bad claim is the product working. */
  refusals: number;
  byChapter: Array<{ chapter: number; started: number; completed: number }>;
  byDay: Array<{ day: string; sessions: number; events: number }>;
  byDevice: { phone: number; desktop: number; unknown: number };
  rejectedEvents: number;
  generatedAt: number;
}

export function createAtlasUsageState(): AtlasUsageState {
  return { version: 1, sessions: {}, days: {}, rejected: 0 };
}

export function atlasUsageDay(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

/**
 * Whether an event is one this module will count.
 *
 * Refusing rather than coercing matters here: a number we report to judges is
 * only worth having if we can say exactly what was counted. A malformed event
 * is recorded as `rejected` so the count of what we threw away is visible too.
 */
export function isAtlasUsageEvent(value: unknown): value is AtlasUsageEvent {
  if (typeof value !== 'object' || value === null) return false;
  const event = value as Record<string, unknown>;
  if (!ATLAS_USAGE_EVENTS.includes(event.name as AtlasUsageEventName)) return false;
  if (typeof event.session !== 'string' || event.session.length < 8 || event.session.length > 64) return false;
  if (typeof event.at !== 'number' || !Number.isFinite(event.at)) return false;
  const needsChapter = event.name === 'chapter-start' || event.name === 'chapter-complete';
  if (needsChapter) {
    if (!Number.isInteger(event.chapter) || (event.chapter as number) < 0 || (event.chapter as number) >= ATLAS_USAGE_CHAPTERS) return false;
  } else if (event.chapter !== undefined) {
    return false;
  }
  if (event.device !== undefined && event.device !== 'phone' && event.device !== 'desktop') return false;
  return true;
}

function emptySession(day: string, device: AtlasUsageDevice | null): AtlasUsageSession {
  return { firstDay: day, lastDay: day, days: 1, events: 0, device, chaptersStarted: [], chaptersCompleted: [], verified: 0, refused: 0 };
}

/**
 * Fold one event into the state. Pure, and safe to call with anything.
 *
 * Chapter progress is stored as a set rather than a tally on purpose. A player
 * who replays chapter 1 four times has still completed one chapter, and a
 * funnel that says otherwise is the kind of number that falls apart the moment
 * somebody asks how it was measured.
 */
export function foldAtlasUsage(state: AtlasUsageState, event: unknown): AtlasUsageState {
  if (!isAtlasUsageEvent(event)) return { ...state, rejected: state.rejected + 1 };
  const day = atlasUsageDay(event.at);
  const sessions = { ...state.sessions };
  const existing = sessions[event.session];
  const session: AtlasUsageSession = existing
    ? { ...existing, chaptersStarted: [...existing.chaptersStarted], chaptersCompleted: [...existing.chaptersCompleted] }
    : emptySession(day, event.device ?? null);

  if (session.events >= ATLAS_USAGE_MAX_EVENTS_PER_SESSION) return { ...state, rejected: state.rejected + 1 };

  if (existing && day !== existing.lastDay) {
    session.lastDay = day;
    session.days = existing.days + 1;
  }
  if (!session.device && event.device) session.device = event.device;
  session.events += 1;

  if (event.name === 'chapter-start' && !session.chaptersStarted.includes(event.chapter!)) session.chaptersStarted.push(event.chapter!);
  if (event.name === 'chapter-complete') {
    if (!session.chaptersCompleted.includes(event.chapter!)) session.chaptersCompleted.push(event.chapter!);
    // Completing without a recorded start still counts as played; a player who
    // arrives mid-run is a real player.
    if (!session.chaptersStarted.includes(event.chapter!)) session.chaptersStarted.push(event.chapter!);
  }
  if (event.name === 'payment-verified') session.verified += 1;
  if (event.name === 'payment-refused') session.refused += 1;

  sessions[event.session] = session;

  const days = { ...state.days };
  const dayRecord = days[day] ?? { sessions: 0, events: 0 };
  days[day] = { sessions: dayRecord.sessions + (existing ? 0 : 1), events: dayRecord.events + 1 };

  return evictOldest({ ...state, sessions, days });
}

/**
 * Keep the stored set bounded by dropping the least recently active sessions.
 *
 * Eviction loses history, so it is reported: `reach` is "sessions we still
 * hold", not "sessions that ever existed". At hackathon scale the cap will not
 * be reached; it exists so a public endpoint cannot be used to grow a file on
 * our disk indefinitely.
 */
function evictOldest(state: AtlasUsageState): AtlasUsageState {
  const keys = Object.keys(state.sessions);
  if (keys.length <= ATLAS_USAGE_MAX_SESSIONS) return state;
  const ordered = keys.sort((left, right) => state.sessions[left]!.lastDay.localeCompare(state.sessions[right]!.lastDay));
  const sessions = { ...state.sessions };
  for (const key of ordered.slice(0, keys.length - ATLAS_USAGE_MAX_SESSIONS)) delete sessions[key];
  return { ...state, sessions };
}

export function summariseAtlasUsage(state: AtlasUsageState, now: number = Date.now()): AtlasUsageSummary {
  const sessions = Object.values(state.sessions);
  const byChapter = Array.from({ length: ATLAS_USAGE_CHAPTERS }, (_value, chapter) => ({
    chapter,
    started: sessions.filter((session) => session.chaptersStarted.includes(chapter)).length,
    completed: sessions.filter((session) => session.chaptersCompleted.includes(chapter)).length,
  }));
  return {
    reach: sessions.length,
    played: sessions.filter((session) => session.chaptersStarted.length > 0).length,
    completed: sessions.filter((session) => session.chaptersCompleted.length > 0).length,
    verified: sessions.filter((session) => session.verified > 0).length,
    returning: sessions.filter((session) => session.days > 1).length,
    refusals: sessions.reduce((total, session) => total + session.refused, 0),
    byChapter,
    byDay: Object.entries(state.days).map(([day, record]) => ({ day, ...record })).sort((left, right) => left.day.localeCompare(right.day)),
    byDevice: {
      phone: sessions.filter((session) => session.device === 'phone').length,
      desktop: sessions.filter((session) => session.device === 'desktop').length,
      unknown: sessions.filter((session) => session.device === null).length,
    },
    rejectedEvents: state.rejected,
    generatedAt: now,
  };
}
