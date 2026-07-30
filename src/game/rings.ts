/**
 * The ring city: stage seven's world, and nothing like the other six.
 *
 * ## Why a new geometry at all
 *
 * Stage seven was a chart run with gates added to it, and it played exactly like
 * the six before it, because it WAS the six before it with extra furniture. A
 * finale that reuses the shape of every earlier stage cannot feel like a finale
 * no matter what is written on it.
 *
 * Stages five and six already left the heightmap for a grid of blocks. Doing
 * that again would be the same move twice. So this is the third shape in the
 * game and it is not a grid or a line:
 *
 *   Concentric rings around a core.
 *
 * You start on the outside and work inward. There is no left and no forward,
 * only closer and further out, and the only way through a ring is the one gap in
 * it. That changes what movement means: on a chart you are outrunning something,
 * in a grid you are choosing a route, and here you are circling a wall looking
 * for the way in. It reads as closing in on something rather than crossing
 * anything.
 *
 * ## Why rings, for this stage in particular
 *
 * The last stage is about working out what is actually going on. A spiral toward
 * a centre is what that looks like from above: everything you learn takes you one
 * ring closer to the thing at the middle, and you can always see how far in you
 * have got by looking at where you are standing.
 *
 * ## Collision without boxes
 *
 * A ring is not an axis-aligned rectangle, so the block collision the grid city
 * uses does not apply. It is far simpler instead: a point is solid when its
 * distance from the core falls inside a ring's band AND its angle is not inside
 * that ring's gap. Two comparisons, no list to iterate, no corners.
 *
 * That also means the whole world is described by a handful of numbers rather
 * than by hundreds of blocks, which is why this file is short.
 *
 * ## Determinism
 *
 * Gap angles come from the level stream at construction. Two players on one seed
 * circle the same walls and find the same openings.
 */

import type { Rng } from '../core/rng';

export interface Ring {
  /** Distance from the core to the middle of the wall. */
  radius: number;
  /** How thick the wall is. */
  thickness: number;
  /** Centre of the gap, radians. */
  gapAt: number;
  /** Half-width of the gap, radians. */
  gapHalf: number;
  /** Shut until the gate for this ring is answered. */
  locked: boolean;
}

export interface RingCity {
  cx: number;
  cy: number;
  width: number;
  height: number;
  rings: Ring[];
  /** Where the run starts: outside everything. */
  startX: number;
  startY: number;
  /** The core. Reaching it is the end of the campaign. */
  coreRadius: number;
}

/** Gap between one ring and the next. Room to fly around looking for the way in. */
const RING_SPACING = 520;
/** How thick a ring wall is. Solid enough to read, thin enough to pass quickly. */
const RING_THICKNESS = 46;
/** The innermost radius. Everything inside this is the core. */
const CORE_RADIUS = 300;

/**
 * How wide a gap is, in radians, at the innermost ring.
 *
 * Expressed as an arc LENGTH rather than an angle, then converted per ring, so
 * the opening is the same number of world units wide wherever it is. An angular
 * constant would make the outer gaps enormous and the inner ones impassable.
 */
const GAP_ARC = 260;

export function buildRingCity(rng: Rng, count: number): RingCity {
  const rings: Ring[] = [];

  /*
   * Built inside out, so ring 0 is the innermost and the index matches how far
   * you have got. The gates are numbered the same way, which keeps the two from
   * disagreeing about which wall is which.
   */
  for (let i = 0; i < count; i++) {
    const radius = CORE_RADIUS + RING_SPACING * (i + 1);

    rings.push({
      radius,
      thickness: RING_THICKNESS,
      /*
       * Gaps are scattered rather than aligned.
       *
       * Lining them up would make the whole city a straight run to the middle,
       * which is the corridor problem again in a circle. Offset so that leaving
       * one gap never points at the next.
       */
      gapAt: rng.range(0, Math.PI * 2),
      gapHalf: Math.min(Math.PI * 0.4, GAP_ARC / (2 * radius)),
      locked: true,
    });
  }

  const outer = CORE_RADIUS + RING_SPACING * (count + 1);
  const size = Math.round(outer * 2);

  return {
    cx: outer,
    cy: outer,
    width: size,
    height: size,
    rings,
    // Out beyond the last wall, on the approach.
    startX: outer,
    startY: Math.round(outer + outer * 0.86),
    coreRadius: CORE_RADIUS,
  };
}

/** Distance and angle from the core. The only two numbers this world needs. */
export function polar(city: RingCity, x: number, y: number): { r: number; a: number } {
  const dx = x - city.cx;
  const dy = y - city.cy;
  return { r: Math.hypot(dx, dy), a: Math.atan2(dy, dx) };
}

/** Shortest angular distance between two angles, always positive. */
function angleGap(a: number, b: number): number {
  const raw = Math.abs(a - b) % (Math.PI * 2);
  return raw > Math.PI ? Math.PI * 2 - raw : raw;
}

/**
 * Is this point inside a wall?
 *
 * Inside a ring's band and outside its gap. An unlocked ring is open along its
 * whole circumference, because once you have answered for a ring there is no
 * reason to make you find the same gap again on the way back.
 */
export function solidAt(city: RingCity, x: number, y: number): boolean {
  const { r, a } = polar(city, x, y);

  for (const ring of city.rings) {
    if (!ring.locked) continue;
    if (Math.abs(r - ring.radius) > ring.thickness / 2) continue;
    if (angleGap(a, ring.gapAt) <= ring.gapHalf) continue;
    return true;
  }

  return false;
}

/**
 * Push a circle out of any wall it is inside.
 *
 * Radially, which is the only direction that makes sense here: a ring's surface
 * is perpendicular to the line from the core, so out means further from or
 * closer to the middle depending on which side you hit it from. Sliding along
 * the wall falls out of this for free, since the tangential component is never
 * touched.
 */
export function resolve(
  city: RingCity,
  x: number,
  y: number,
  radius: number,
): { x: number; y: number; hit: boolean } {
  const { r, a } = polar(city, x, y);

  for (const ring of city.rings) {
    if (!ring.locked) continue;

    const half = ring.thickness / 2 + radius;
    if (Math.abs(r - ring.radius) > half) continue;
    if (angleGap(a, ring.gapAt) <= ring.gapHalf) continue;

    // Whichever side is nearer. Pushing through a wall would be worse than
    // pushing back out of it.
    const out = r >= ring.radius ? ring.radius + half : ring.radius - half;
    return { x: city.cx + Math.cos(a) * out, y: city.cy + Math.sin(a) * out, hit: true };
  }

  return { x, y, hit: false };
}

/** Which ring the player is currently outside of, or -1 once at the core. */
export function ringAt(city: RingCity, x: number, y: number): number {
  const { r } = polar(city, x, y);
  for (let i = city.rings.length - 1; i >= 0; i--) {
    if (r > city.rings[i]!.radius) return i;
  }
  return -1;
}

/** True when the player has reached the middle. */
export function atCore(city: RingCity, x: number, y: number): boolean {
  return polar(city, x, y).r <= city.coreRadius;
}

/**
 * Somewhere open on the approach to a given ring.
 *
 * Used to place the things worth flying to. Placed in the band OUTSIDE the ring
 * it belongs to, so what you need for a wall is always on the side of it you are
 * standing on.
 */
export function spotOutside(
  city: RingCity,
  rng: Rng,
  ringIndex: number,
): { x: number; y: number } {
  const ring = city.rings[ringIndex];
  const inner = ring ? ring.radius + ring.thickness : city.coreRadius;
  const next = city.rings[ringIndex + 1];
  const outer = next ? next.radius - next.thickness : inner + RING_SPACING * 0.8;

  const r = rng.range(inner + 70, Math.max(inner + 90, outer - 70));
  const a = rng.range(0, Math.PI * 2);

  return { x: city.cx + Math.cos(a) * r, y: city.cy + Math.sin(a) * r };
}
