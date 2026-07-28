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

/** Roughly the altitude a player holds when they are not doing anything clever. */
const COMFORT_CLEARANCE = 200;
const COUNT = 6;

export function layOutRefills(
  rng: Rng,
  terrain: Terrain,
  nextId: () => number,
  extractionX: number,
): Refill[] {
  const refills: Refill[] = [];

  const first = 1100;
  const last = extractionX - 400;
  const step = (last - first) / COUNT;

  for (let i = 0; i < COUNT; i++) {
    // Spread evenly with a little jitter, so they arrive at a rhythm rather
    // than clustering wherever the chart happened to be flat.
    const x = first + step * i + rng.range(step * 0.2, step * 0.75);

    // Near the comfortable altitude, not exactly on it. Close enough to grab
    // without a detour, far enough that flying the line collects them all
    // without any thought.
    const comfortable = terrain.groundAt(x) - COMFORT_CLEARANCE;
    const y = comfortable + rng.range(-52, 52);

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
