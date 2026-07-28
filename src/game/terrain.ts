/**
 * The chart, turned into ground you can crash into.
 *
 * The mission carries 240 normalised points, oldest first. Point 0 is the left
 * edge of the level and the last point is the extraction end. A value of 1 is
 * the day's high, which sits high on screen, so the player is literally flying
 * the price line and the ground rises and falls with it.
 *
 * Volatility is precomputed here because the spawner needs it and recomputing
 * a rolling window every frame would be silly. Choppy stretches of the real
 * day become the dangerous stretches of the level.
 */

import { TERRAIN_POINTS } from './mission';

/** World units between two chart points. */
export const POINT_SPACING = 48;
export const WORLD_WIDTH = (TERRAIN_POINTS - 1) * POINT_SPACING;
export const WORLD_HEIGHT = 960;

/** Screen y of a chart value of 0, the day's low. */
const GROUND_BASE = 900;
/** How far the day's high sits above the day's low. */
const TERRAIN_AMPLITUDE = 430;
/** Hard ceiling. Flying above the chart is fine, leaving the world is not. */
export const CEILING = 48;

/** Where the run ends. Everything past here is the extraction pad. */
export const EXTRACTION_X = WORLD_WIDTH - POINT_SPACING * 3;

export class Terrain {
  /** Ground y at each chart point, in world units. */
  readonly heights: number[];
  /** Rolling volatility per point, normalised 0 to 1. Drives spawn density. */
  readonly volatility: number[];

  constructor(normalised: readonly number[]) {
    this.heights = normalised.map((v) => GROUND_BASE - v * TERRAIN_AMPLITUDE);
    this.volatility = computeVolatility(normalised);
  }

  /** Ground y at a world x, linearly interpolated between chart points. */
  groundAt(x: number): number {
    const position = x / POINT_SPACING;
    const low = Math.floor(position);

    if (low < 0) return this.heights[0] ?? GROUND_BASE;
    if (low >= this.heights.length - 1) {
      return this.heights[this.heights.length - 1] ?? GROUND_BASE;
    }

    const a = this.heights[low] ?? GROUND_BASE;
    const b = this.heights[low + 1] ?? a;
    return a + (b - a) * (position - low);
  }

  /** Volatility at a world x, 0 calm to 1 chaotic. */
  volatilityAt(x: number): number {
    const index = clampIndex(Math.round(x / POINT_SPACING), this.volatility.length);
    return this.volatility[index] ?? 0;
  }

  /**
   * A y that is clear of the ground at this x, used to place things that must
   * not spawn inside a hill. Returns a height above the ground by `clearance`,
   * pulled back under the ceiling if the chart is high here.
   */
  clearAbove(x: number, clearance: number): number {
    return Math.max(CEILING + 24, this.groundAt(x) - clearance);
  }
}

/**
 * Absolute point-to-point change, smoothed over a small window and normalised
 * against the busiest stretch of the day. Normalising against the day itself
 * matters: a quiet coin should still have a busy section, otherwise a low
 * volatility day produces an empty level.
 */
function computeVolatility(values: readonly number[]): number[] {
  const window = 6;
  const deltas = values.map((v, i) =>
    i === 0 ? 0 : Math.abs(v - (values[i - 1] ?? v)),
  );

  const smoothed = deltas.map((_, i) => {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - window); j <= Math.min(deltas.length - 1, i + window); j++) {
      sum += deltas[j] ?? 0;
      count++;
    }
    return count > 0 ? sum / count : 0;
  });

  const peak = Math.max(...smoothed);
  if (peak <= 0) return smoothed.map(() => 0.5);
  return smoothed.map((v) => v / peak);
}

function clampIndex(index: number, length: number): number {
  return Math.min(length - 1, Math.max(0, index));
}
