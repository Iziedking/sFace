/**
 * Hull refills, dropped along the route as NIM-style tokens.
 *
 * These are the opposite of a cache and the difference is the whole point.
 *
 *   A cache sits **off** the comfortable line. It rewards knowing where to go
 *   and being willing to spend clock getting there. It is skill.
 *
 *   A refill sits **on** it. It is a lifeline, not a prize, and burying a
 *   lifeline behind a hard dive punishes exactly the player who already needed
 *   it. A run that has gone badly should be recoverable by continuing to fly
 *   well, not only by taking a risk you are in no state to take.
 *
 * They are placed once, from the level stream, so both sides of a challenge
 * find the same lifelines in the same places. Anything else would hand one
 * player a second chance the other never had.
 */

import type { Rng } from '../core/rng';
import type { Terrain } from './terrain';


export interface Refill {
  id: number;
  x: number;
  y: number;
  taken: boolean;
  /** So a row of them does not bob in lockstep. */
  phase: number;
}

/** Hull restored, out of 100. Meaningful without trivialising a bad run. */
export const REFILL_HEAL = 32;
export const REFILL_REACH = 30;

/**
 * The player's radius, duplicated rather than imported.
 *
 * player.ts imports state.ts which imports this file, so reaching for the real
 * constant would close a cycle. Seventeen is small and has not moved; if it
 * ever does, the test that asserts every refill is on the comfortable line is
 * what will notice.
 */
const PLAYER_SPAN = 17;

/** Roughly the altitude a player holds when they are not doing anything clever. */
const COMFORT_CLEARANCE = 200;

export function layOutRefills(
  rng: Rng,
  terrain: Terrain,
  nextId: () => number,
  extractionX: number,
  /** How many this stage lays down. See the stage table for why it varies. */
  count: number,
): Refill[] {
  const refills: Refill[] = [];
  if (count <= 0) return refills;

  const first = 1100;
  const last = extractionX - 400;
  const step = (last - first) / count;

  for (let i = 0; i < count; i++) {
    // Spread evenly with a little jitter, so they arrive at a rhythm rather
    // than clustering wherever the chart happened to be flat.
    const x = first + step * i + rng.range(step * 0.2, step * 0.75);

    /*
     * Near the comfortable altitude, not exactly on it. Close enough to grab
     * without a detour, far enough that flying the line collects them all
     * without any thought.
     *
     * The spread is smaller than the reach that defines "without a detour"
     * (REFILL_REACH plus the player's radius), so every refill is genuinely on
     * the line. It used to be wider than that, and the design only held
     * because six of them per stage meant one always landed close by accident.
     * Cutting the count to two on stage one turned that luck into a stage
     * where neither lifeline was actually on the route.
     */
    const comfortable = terrain.groundAt(x) - COMFORT_CLEARANCE;
    const spread = (REFILL_REACH + PLAYER_SPAN) * 0.85;
    const y = comfortable + rng.range(-spread, spread);

    refills.push({
      id: nextId(),
      x,
      y: clamp(y, 70, terrain.groundAt(x) - 34),
      taken: false,
      phase: rng.range(0, Math.PI * 2),
    });
  }

  return refills;
}

function clamp(value: number, min: number, max: number): number {
  return min > max ? min : Math.min(max, Math.max(min, value));
}
