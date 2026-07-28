/**
 * Recorded runs, kept per mission seed.
 *
 * The service treats a trace as opaque bytes. It checks the size and the
 * alphabet and nothing else, because decoding it here would mean importing the
 * game's codec, which pulls in the terrain and the mission modules and drags
 * browser-shaped code into the service for no benefit. The real validator is
 * `decodeTrace` in the client, which returns null on anything malformed, so a
 * corrupt trace costs one missing ghost rather than an exception mid-run.
 *
 * That is the right place for the boundary: the client is the only party that
 * has to make sense of the bytes, and it already refuses to trust them.
 */

/** A 90 second run at 20Hz is about 14 kB of base64. This is generous. */
const MAX_TRACE_CHARS = 32_000;
/** Kept per seed, best score first. Enough to fill a squad several times over. */
const KEEP_PER_SEED = 12;

export interface Ghost {
  deviceId: string;
  name: string;
  score: number;
  facesExtracted: number;
  /** Base64, opaque here. */
  trace: string;
  at: number;
}

export interface PublicGhost {
  id: string;
  name: string;
  score: number;
  facesExtracted: number;
  trace: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; reason: string; code: number };

/** seed -> deviceId -> ghost */
const bySeed = new Map<string, Map<string, Ghost>>();

export function submit(input: {
  deviceId: string;
  name: string;
  seed: string;
  score: number;
  facesExtracted: number;
  trace: string;
}): Result<{ stored: boolean }> {
  if (input.trace.length > MAX_TRACE_CHARS) {
    return { ok: false, reason: 'That recording is too long.', code: 413 };
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.trace)) {
    return { ok: false, reason: 'That recording is not valid base64.', code: 400 };
  }

  const room = bySeed.get(input.seed) ?? new Map<string, Ghost>();
  bySeed.set(input.seed, room);

  const existing = room.get(input.deviceId);
  // One recording per device per seed, and it is their best one. Otherwise a
  // player who runs twenty times fills every squad slot with themselves.
  if (existing && existing.score >= input.score) {
    return { ok: true, value: { stored: false } };
  }

  room.set(input.deviceId, {
    deviceId: input.deviceId,
    name: input.name,
    score: input.score,
    facesExtracted: input.facesExtracted,
    trace: input.trace,
    at: Date.now(),
  });

  trim(room);
  persist();
  return { ok: true, value: { stored: true } };
}

/**
 * The best runs on this seed, excluding the caller's own. Flying next to a
 * recording of yourself is a strange experience and not the one we are after.
 */
export function top(seed: string, limit: number, excludeDeviceId?: string): PublicGhost[] {
  const room = bySeed.get(seed);
  if (!room) return [];

  return [...room.values()]
    .filter((ghost) => ghost.deviceId !== excludeDeviceId)
    .sort((a, b) => b.score - a.score || a.at - b.at)
    .slice(0, Math.max(0, Math.min(limit, KEEP_PER_SEED)))
    .map((ghost) => ({
      id: ghost.deviceId,
      name: ghost.name,
      score: ghost.score,
      facesExtracted: ghost.facesExtracted,
      trace: ghost.trace,
    }));
}

function trim(room: Map<string, Ghost>): void {
  if (room.size <= KEEP_PER_SEED) return;

  const ranked = [...room.values()].sort((a, b) => b.score - a.score || a.at - b.at);
  for (const ghost of ranked.slice(KEEP_PER_SEED)) {
    room.delete(ghost.deviceId);
  }
}

// Persistence -------------------------------------------------------------

export function serialise(): unknown {
  return [...bySeed.entries()].map(([seed, room]) => [seed, [...room.values()]]);
}

export function restore(raw: unknown): void {
  if (!Array.isArray(raw)) return;

  for (const pair of raw) {
    if (!Array.isArray(pair) || pair.length !== 2) continue;
    const [seed, ghosts] = pair as [unknown, unknown];
    if (typeof seed !== 'string' || !Array.isArray(ghosts)) continue;

    const room = new Map<string, Ghost>();
    for (const ghost of ghosts as Ghost[]) {
      if (ghost && typeof ghost.deviceId === 'string' && typeof ghost.trace === 'string') {
        room.set(ghost.deviceId, ghost);
      }
    }
    bySeed.set(seed, room);
  }
}

/**
 * Traces are the bulkiest thing this service stores, and a seed is only
 * playable on its own day, so old rooms are dropped wholesale rather than aged
 * out one at a time.
 */
export function prune(activeSeeds: readonly string[]): void {
  const keep = new Set(activeSeeds);
  for (const seed of bySeed.keys()) {
    if (!keep.has(seed)) bySeed.delete(seed);
  }
}

let persist: () => void = () => {};

export function onChange(handler: () => void): void {
  persist = handler;
}

export { MAX_TRACE_CHARS, KEEP_PER_SEED };
