/**
 * Collision helpers. Circles and a heightfield, nothing clever.
 *
 * Every entity in this game is round enough that a circle is honest, and the
 * ground is a single-valued height per x, so ground contact is one lookup and
 * a comparison. A broadphase would be premature: the level holds a few dozen
 * enemies and a couple of hundred bullets at worst, and the whole thing runs
 * at 60Hz on a phone without one.
 */

import type { Terrain } from './terrain';

export interface Circle {
  x: number;
  y: number;
  r: number;
}

export function circlesOverlap(a: Circle, b: Circle): boolean {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const reach = a.r + b.r;
  return dx * dx + dy * dy <= reach * reach;
}

export function withinRange(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  range: number,
): boolean {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy <= range * range;
}

/** How far a circle has sunk into the ground. Zero or less means clear. */
export function groundPenetration(circle: Circle, terrain: Terrain): number {
  return circle.y + circle.r - terrain.groundAt(circle.x);
}

export function hitsGround(circle: Circle, terrain: Terrain): boolean {
  return groundPenetration(circle, terrain) > 0;
}

/** Unit vector from a to b. Returns a forward-facing default when they coincide. */
export function direction(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { x: number; y: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return { x: 1, y: 0 };
  return { x: dx / length, y: dy / length };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
