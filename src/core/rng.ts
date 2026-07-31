/**
 * Seeded pseudo-random number generator.
 *
 * This is the load-bearing piece of the whole design. Every client feeds the
 * same daily seed string into it and generates an identical level: same waves,
 * same face placements, same everything. That is what makes challenges fair,
 * ghosts replayable, and live co-op cheap later, without exchanging a packet.
 *
 * mulberry32 is fast, tiny, and good enough for a game. Do not swap it for
 * Math.random anywhere that affects the level, or runs stop matching.
 */

/** Turn an arbitrary seed string into a 32-bit integer. */
export function hashSeed(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

export class Rng {
  private state: number;

  constructor(seed: string | number) {
    this.state = typeof seed === 'string' ? hashSeed(seed) : seed >>> 0;
  }

  /**
   * The whole generator, as one number.
   *
   * A run that survives a page refresh has to pick up the same random stream it
   * was on, or the resumed half of the level behaves like a different level.
   * The state is a single uint32, so this costs nothing and removes the only
   * part of a snapshot that could not otherwise be rebuilt from the seed.
   */
  save(): number {
    return this.state;
  }

  load(state: number): void {
    this.state = state >>> 0;
  }

  /** Next float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Integer in [min, max]. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /** Pick one item. */
  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)];
  }

  /** True with the given probability. */
  chance(probability: number): boolean {
    return this.next() < probability;
  }
}
