/**
 * Caches: the residue of the Collapse, and the reason skill is legible.
 *
 * The design problem this solves is specific. People to rescue sit on the
 * critical path, so a good pilot and a bad pilot fly the same line and the
 * only difference between them is who survives it. That is a survival game,
 * not a skill game. Caches sit deliberately **off** that line, so being good
 * means knowing where to go and being willing to spend clock getting there.
 *
 * Where each tier lives is the whole mechanic:
 *
 *   sealed  Slightly off the comfortable altitude. A small detour.
 *   vault   Down in a local trough, near the ground, usually with something
 *           shooting at you. Somewhere you would not fly by accident.
 *   relic   One per day, at the single lowest point of the day's chart.
 *
 * The relic placement is the part worth protecting. The lowest point of the
 * chart is the worst moment of that day's market, and that is exactly where
 * the most valuable thing is buried. It ties the reward to the premise without
 * a line of explanation, and it means every day's best prize is somewhere the
 * market itself chose.
 *
 * Placement draws from the level stream, once, at construction. It has to:
 * two players betting on the same seed must be able to find the same relic in
 * the same place, or the bet is not a bet.
 */

import type { Rng } from '../core/rng';
import { CACHES, type CacheTier } from '../data/story';
import type { Terrain } from './terrain';
import { CEILING, POINT_SPACING } from './terrain';

export interface Cache {
  id: number;
  tier: CacheTier;
  x: number;
  y: number;
  taken: boolean;
  /** Animation offset so a row of them does not pulse in lockstep. */
  phase: number;
}

/** Roughly where an unadventurous pilot flies. Caches avoid this band. */
const COMFORT_CLEARANCE = 200;
const COMFORT_BAND = 70;

/** How many sealed caches a level holds, before difficulty adjusts it. */
const SEALED_BASE = 6;
const MAX_VAULTS = 3;

export function layOutCaches(
  rng: Rng,
  terrain: Terrain,
  difficulty: number,
  nextId: () => number,
  /** The pad for this stage. Earlier stages fly a shorter piece of the day. */
  extractionX: number,
  /** How many the stage asks for, sealed caches included. */
  total: number,
): Cache[] {
  const caches: Cache[] = [];
  const first = 900;
  const last = extractionX - 300;

  // The relic goes at the bottom of the day. Not near the bottom: the actual
  // lowest point of the chart the market produced.
  const trough = deepestPoint(terrain, first, last);
  caches.push({
    id: nextId(),
    tier: 'relic',
    x: trough,
    // Tucked right down against the ground so you have to commit to the dive.
    y: terrain.groundAt(trough) - 38,
    taken: false,
    phase: rng.range(0, Math.PI * 2),
  });

  // Vaults sit in other local troughs, which is where a chart spent its worst
  // minutes and where the attackers already are.
  const troughs = localTroughs(terrain, first, last).filter(
    (x) => Math.abs(x - trough) > 900,
  );

  for (let i = 0; i < Math.min(MAX_VAULTS, troughs.length); i++) {
    // Spread the picks across the level rather than taking the deepest three,
    // which would cluster them wherever the chart happened to be ugly.
    const pick = troughs[Math.floor((i + 0.5) * (troughs.length / MAX_VAULTS))] ?? troughs[i];
    if (pick === undefined) continue;

    caches.push({
      id: nextId(),
      tier: 'vault',
      x: pick + rng.range(-40, 40),
      y: terrain.groundAt(pick) - rng.range(46, 78),
      taken: false,
      phase: rng.range(0, Math.PI * 2),
    });
  }

  // Sealed caches are scattered, always outside the comfortable band: either
  // pressed against the ceiling or hugging the terrain.
  // The stage sets the headcount; difficulty still nudges it. One relic and
  // up to three vaults are already placed, so the rest are sealed.
  const placed = caches.length;
  const count = Math.max(
    2,
    (total > 0 ? total : SEALED_BASE + placed + (difficulty >= 4 ? 2 : 0)) - placed,
  );
  const step = (last - first) / count;

  for (let i = 0; i < count; i++) {
    const x = first + step * i + rng.range(step * 0.15, step * 0.7);
    const ground = terrain.groundAt(x);
    const comfortable = ground - COMFORT_CLEARANCE;

    // Coin flip on high or low, then far enough from the comfortable altitude
    // that flying the easy line never collects one by accident.
    const high = rng.chance(0.5);
    const y = high
      ? clamp(
          comfortable - rng.range(COMFORT_BAND + 40, COMFORT_BAND + 190),
          CEILING + 34,
          comfortable - COMFORT_BAND,
        )
      : clamp(
          ground - rng.range(34, 74),
          comfortable + COMFORT_BAND,
          ground - 30,
        );

    caches.push({
      id: nextId(),
      tier: 'sealed',
      x,
      y,
      taken: false,
      phase: rng.range(0, Math.PI * 2),
    });
  }

  return caches;
}

/** World x of the chart's single lowest point, which is its highest y. */
function deepestPoint(terrain: Terrain, from: number, to: number): number {
  let bestX = from;
  let bestY = -Infinity;

  const fromIndex = Math.max(1, Math.floor(from / POINT_SPACING));
  const toIndex = Math.min(terrain.heights.length - 2, Math.floor(to / POINT_SPACING));

  for (let i = fromIndex; i <= toIndex; i++) {
    const y = terrain.heights[i] ?? -Infinity;
    if (y > bestY) {
      bestY = y;
      bestX = i * POINT_SPACING;
    }
  }

  return bestX;
}

/**
 * Every local trough, deepest first.
 *
 * A point counts when it sits lower than the ground a short way either side,
 * which filters out the noise of a chart that wobbles every other sample and
 * leaves the dips a player would actually recognise as a dip.
 */
function localTroughs(terrain: Terrain, from: number, to: number): number[] {
  const window = 5;
  const found: Array<{ x: number; y: number }> = [];

  const fromIndex = Math.max(window, Math.floor(from / POINT_SPACING));
  const toIndex = Math.min(
    terrain.heights.length - 1 - window,
    Math.floor(to / POINT_SPACING),
  );

  for (let i = fromIndex; i <= toIndex; i++) {
    const y = terrain.heights[i] ?? 0;
    let lowest = true;
    for (let j = i - window; j <= i + window; j++) {
      if (j === i) continue;
      if ((terrain.heights[j] ?? 0) > y) {
        lowest = false;
        break;
      }
    }
    if (lowest) found.push({ x: i * POINT_SPACING, y });
  }

  return found.sort((a, b) => b.y - a.y).map((p) => p.x);
}

export function cacheReach(tier: CacheTier): number {
  return CACHES[tier].reach;
}

export function cacheFace(tier: CacheTier): number {
  return CACHES[tier].face;
}

function clamp(value: number, min: number, max: number): number {
  // A clamp whose bounds have crossed would otherwise return the wrong end.
  return min > max ? min : Math.min(max, Math.max(min, value));
}
