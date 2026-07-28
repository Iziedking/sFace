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

/** Must match TERRAIN_POINTS in server/oracle.ts or level geometry shifts. */
export const TERRAIN_POINTS = 240;

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
}

const API_BASE = import.meta.env.VITE_API_BASE ?? '';

export interface MissionLoad {
  mission: DailyMission;
  /** Set when we fell back, so the brief screen can say so plainly. */
  notice: string | null;
}

/**
 * Fetch today's mission. Never rejects: a run must always be startable, because
 * the alternative is a judge staring at a spinner.
 */
export async function loadMission(signal?: AbortSignal): Promise<MissionLoad> {
  if (!API_BASE) {
    return { mission: practiceMission(), notice: 'Practice mission. No market data configured.' };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    signal?.addEventListener('abort', () => controller.abort(), { once: true });

    const response = await fetch(`${API_BASE}/mission/today`, {
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) throw new Error(`mission ${response.status}`);

    const mission = parseMission(await response.json());
    if (!mission) throw new Error('mission payload failed validation');

    return { mission, notice: null };
  } catch {
    return {
      mission: practiceMission(),
      notice: 'Could not reach the market. This is a practice mission.',
    };
  }
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
  };
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
