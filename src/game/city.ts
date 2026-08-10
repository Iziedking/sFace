/**
 * A city, generated from the day's chart.
 *
 * ## Why the heightmap had to go
 *
 * Every stage until now runs on `terrain.groundAt(x)`: one ground height per
 * column. That is mathematically a corridor. There is exactly one surface,
 * everything above it is air, and the only direction that means anything is
 * forward. No amount of work on a stage gets you a place to explore while the
 * world is a height function, because a building beside a street needs solid,
 * then air, then solid in the same vertical slice, and a height function cannot
 * say that.
 *
 * So a city is a list of solid boxes with gaps between them, and the gaps are
 * the streets. Movement is free in both axes, routes fork, and a corner is
 * something you have not looked round yet.
 *
 * ## Why it still comes from the chart
 *
 * The premise is that the market builds the level, and abandoning that for a
 * hand-drawn map would make the city a generic arena that happens to live in
 * this app. It does not need abandoning. A price line drawn as BARS is already
 * a skyline: each bar has a height, they sit side by side, and the gaps between
 * them are exactly where a street goes. Same seed, same numbers, projected
 * differently. A violent day gives a jagged skyline full of cover; a flat day
 * gives long open avenues with nowhere to hide.
 *
 * ## Determinism
 *
 * The layout is drawn once from the level stream at construction, like every
 * other thing two players must share. Nothing here is decided during play.
 */

import type { Rng } from '../core/rng';

export interface Block {
  /** Left edge, top edge, and size. Axis aligned: a city is a grid of boxes. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A building you can walk into.
 *
 * Four walls with a gap in one of them, and the gap is the whole point: it is
 * wide enough for a person and too narrow for the car. So anything worth having
 * in here costs you the car, which turns "drive or walk" from a decision you
 * make once at the start into one you keep making.
 */
export interface Room {
  /** The open floor inside, not counting the walls. Loot goes in here. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Which wall the way in is cut through. */
  door: 'north' | 'south' | 'east' | 'west';
}

export interface City {
  blocks: Block[];
  /**
   * The enterable buildings. Empty is a valid city, so nothing may assume one
   * exists: on a day whose bars are all small, no block is big enough inside.
   */
  rooms: Room[];
  /** Full extent, so the camera and spawns have something to clamp against. */
  width: number;
  height: number;
  /** Where the run starts, in the open. */
  startX: number;
  startY: number;
  /** Where the run ends. A point on a map, not the right-hand edge of a line. */
  exitX: number;
  exitY: number;
}

/** Street width. Wide enough to drive and turn, tight enough to feel like one. */
const STREET = 190;
/**
 * Depth of the map, in avenues.
 *
 * Six, not three. Three produced a map six times wider than it was deep, which
 * is a corridor with side-alleys rather than a place: every route was still
 * fundamentally left-to-right and the whole point of leaving the heightmap was
 * to stop that. Roughly square is what makes a direction a choice.
 */
const AVENUES = 6;

/**
 * How many buildings across.
 *
 * Read off the chart rather than chosen, so the city is as long as the day was
 * eventful. Capped so a long terrain array cannot produce a map nobody can
 * cross in the time allowed.
 */
const MAX_COLUMNS = 8;

/** How thick the wall of an enterable building is. */
export const WALL = 34;

/**
 * How wide the way in is.
 *
 * Fifty-six, and the number is doing real work. A person is seventeen across so
 * needs thirty-four of clearance and fits with room to spare. The car is
 * thirty-two across and needs sixty-four, so it does not fit at all.
 *
 * That is deliberate. Every building you can enter is a place the car cannot
 * follow, so the loot inside is only ever reachable on foot. Without the gap
 * being between those two numbers the interiors would either be another thing
 * you drive into or a wall with a decorative notch.
 */
const DOORWAY = 56;

/**
 * Smallest interior worth cutting a door into.
 *
 * Below this the inside is a cupboard: you clip the walls turning around, and a
 * refill in there is more annoying than rewarding. Blocks that come out smaller
 * than this stay solid, which is why a calm day has fewer of them.
 */
const MIN_INSIDE = 110;

/** How many of the eligible buildings get opened up. */
const OPEN_CHANCE = 0.5;

const DOORS = ['north', 'south', 'east', 'west'] as const;

/**
 * Turn one solid box into four walls with a gap in one of them.
 *
 * Emitted as ordinary blocks rather than as a new kind of thing, which is the
 * whole reason this is cheap: solidAt, resolve and lineBlocked already handle
 * axis-aligned boxes correctly, so an interior needs no collision code, no
 * special casing in the patrol line-of-sight test, and no new failure mode where
 * a wall stops bullets but not people. A room is just a box with a hole, spelled
 * out in boxes.
 *
 * The doorway is centred on its wall. Off-centre would look more organic and
 * would also mean a player who has learned where a door is on one building
 * cannot use that anywhere else, which is texture bought at the cost of
 * legibility.
 */
function hollow(blocks: Block[], box: Block, door: Room['door']): void {
  const { x, y, w, h } = box;
  const right = x + w;
  const bottom = y + h;

  // Runs the full width, so the corners belong to the horizontal walls and the
  // verticals sit between them. Without picking one, corners get two overlapping
  // blocks, which is harmless but doubles the block count for nothing.
  const across = (top: number, thickness: number, cut: boolean): void => {
    if (!cut) {
      blocks.push({ x, y: top, w, h: thickness });
      return;
    }
    const gapFrom = Math.round(x + (w - DOORWAY) / 2);
    blocks.push({ x, y: top, w: gapFrom - x, h: thickness });
    blocks.push({ x: gapFrom + DOORWAY, y: top, w: right - (gapFrom + DOORWAY), h: thickness });
  };

  const down = (left: number, thickness: number, cut: boolean): void => {
    const from = y + WALL;
    const to = bottom - WALL;
    if (!cut) {
      blocks.push({ x: left, y: from, w: thickness, h: to - from });
      return;
    }
    const gapFrom = Math.round(from + (to - from - DOORWAY) / 2);
    blocks.push({ x: left, y: from, w: thickness, h: gapFrom - from });
    blocks.push({ x: left, y: gapFrom + DOORWAY, w: thickness, h: to - (gapFrom + DOORWAY) });
  };

  across(y, WALL, door === 'north');
  across(bottom - WALL, WALL, door === 'south');
  down(x, WALL, door === 'west');
  down(right - WALL, WALL, door === 'east');
}

export function buildCity(rng: Rng, chart: number[]): City {
  const columns = Math.min(MAX_COLUMNS, Math.max(6, Math.floor(chart.length / 30)));
  const blocks: Block[] = [];
  const rooms: Room[] = [];

  /*
   * One column of the chart per column of buildings, sampled evenly across the
   * whole day rather than taking the first N points. Taking the front would
   * make every city the shape of the first ten minutes of trading.
   */
  const stride = chart.length / columns;
  const cell = STREET * 2.4;

  for (let col = 0; col < columns; col++) {
    for (let row = 0; row < AVENUES; row++) {
      /*
       * A gap instead of a building, sometimes. Without these the map is a
       * perfect grid, every junction looks like every other junction, and there
       * is nothing to recognise a place by. A missing block is a square.
       */
      if (rng.chance(0.16)) continue;

      const sample = chart[Math.min(chart.length - 1, Math.floor(col * stride))] ?? 0.5;

      /*
       * Bar height becomes building footprint. A deep drop in the chart is a
       * squat wide block; a peak is a tall narrow one. The day is legible in
       * the skyline if you know what you are looking at.
       */
      const bulk = 0.42 + (1 - sample) * 0.46;
      const w = cell * bulk;
      const h = cell * (0.34 + sample * 0.5);

      const x = STREET + col * (cell + STREET);
      const y = STREET + row * (cell + STREET);

      const box = {
        x: Math.round(x),
        y: Math.round(y),
        w: Math.round(w),
        h: Math.round(h),
      };

      /*
       * Hollow this one out, or leave it solid.
       *
       * Both draws happen for every eligible block whether or not it is opened,
       * so the number of draws taken per block is fixed. Deciding the door side
       * only for the ones that pass would make the draw count depend on the
       * chance roll, and every later draw from the level stream would shift with
       * it. That is the class of bug that makes two players on one seed play
       * subtly different cities.
       */
      const roomy = box.w - WALL * 2 >= MIN_INSIDE && box.h - WALL * 2 >= MIN_INSIDE;
      const opening = rng.chance(OPEN_CHANCE);
      const side = DOORS[rng.int(0, DOORS.length - 1)]!;

      if (roomy && opening) {
        hollow(blocks, box, side);
        rooms.push({
          x: box.x + WALL,
          y: box.y + WALL,
          w: box.w - WALL * 2,
          h: box.h - WALL * 2,
          door: side,
        });
      } else {
        blocks.push(box);
      }
    }
  }

  const width = STREET + columns * (cell + STREET);
  const height = STREET + AVENUES * (cell + STREET);

  return {
    blocks,
    rooms,
    width: Math.round(width),
    height: Math.round(height),
    /*
     * Opposite corners, so the shortest route is a diagonal across the whole
     * map. Starting mid-edge and exiting mid-edge would leave one straight run
     * that is always correct, which is the corridor again in a wider building.
     */
    startX: Math.round(STREET / 2),
    // Clear of the bottom-left minimap on the first camera-clamped frame. The
    // old corner spawn put the player underneath the map before they moved.
    startY: Math.round(height - STREET * 2),
    exitX: Math.round(width - STREET / 2),
    exitY: Math.round(STREET / 2),
  };
}

/** True when this point is inside a building. */
export function solidAt(city: City, x: number, y: number): boolean {
  for (const b of city.blocks) {
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return true;
  }
  return false;
}

/**
 * Push a circle out of anything it is inside.
 *
 * Resolved per axis, smallest correction first, which is the standard way to
 * slide along a wall rather than sticking to it. Sticking is what makes a
 * player feel the collision system instead of the city.
 */
export function resolve(
  city: City,
  x: number,
  y: number,
  r: number,
): { x: number; y: number; hit: boolean } {
  let px = x;
  let py = y;
  let hit = false;

  for (const b of city.blocks) {
    const nearestX = Math.max(b.x, Math.min(px, b.x + b.w));
    const nearestY = Math.max(b.y, Math.min(py, b.y + b.h));
    const dx = px - nearestX;
    const dy = py - nearestY;

    if (dx * dx + dy * dy >= r * r) continue;
    hit = true;

    // Inside, or touching. Work out the cheapest way back out.
    const left = px - (b.x - r);
    const right = b.x + b.w + r - px;
    const up = py - (b.y - r);
    const down = b.y + b.h + r - py;

    const smallest = Math.min(left, right, up, down);
    if (smallest === left) px = b.x - r;
    else if (smallest === right) px = b.x + b.w + r;
    else if (smallest === up) py = b.y - r;
    else py = b.y + b.h + r;
  }

  return { x: px, y: py, hit };
}

/**
 * Is the straight line between two points clear of buildings?
 *
 * The city's version of the terrain occlusion test in sight.ts. Sampled for the
 * same reason: a handful of steps is enough at the ranges this game uses and
 * costs nothing next to solving box intersections per watcher per frame.
 */
export function lineBlocked(
  city: City,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): boolean {
  const steps = 20;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (solidAt(city, fromX + (toX - fromX) * t, fromY + (toY - fromY) * t)) return true;
  }
  return false;
}

/** A free spot in the street, for placing something that must not be inside a wall. */
export function openSpot(city: City, rng: Rng, clearance: number): { x: number; y: number } {
  for (let attempt = 0; attempt < 60; attempt++) {
    const x = rng.range(clearance, city.width - clearance);
    const y = rng.range(clearance, city.height - clearance);
    if (!resolve(city, x, y, clearance).hit) return { x, y };
  }
  /*
   * Give up rather than loop forever on a pathological layout.
   *
   * The number of draws taken here VARIES with how quickly a free spot is
   * found, which would normally be a determinism hazard. It is safe only
   * because the city and the stream are both identical for two players on one
   * seed, so they take the same number of attempts and land on the same spot.
   * That is a property of the caller, not of this function: never call it with
   * a city that differs between clients.
   */
  return { x: city.startX, y: city.startY };
}

/**
 * A spot on the floor of an enterable building, for something worth going in for.
 *
 * Rooms are handed out in order rather than picked at random, so a run with four
 * things to hide puts them in four different buildings instead of stacking two
 * in one and leaving another empty. `which` is the caller's index; it wraps, so
 * asking for more spots than there are rooms doubles some up rather than
 * failing.
 *
 * Returns null when the day produced no interiors, which is a normal outcome on
 * a calm chart and means the caller has to have a street fallback.
 */
export function roomSpot(
  city: City,
  rng: Rng,
  which: number,
  clearance: number,
): { x: number; y: number } | null {
  if (city.rooms.length === 0) return null;

  const room = city.rooms[which % city.rooms.length]!;

  /*
   * Inset by the clearance so nothing spawns half inside its own wall, and
   * centre it when the floor is too small to inset on both sides. Clamping
   * rather than rejecting matters because a refill that failed to place would
   * silently vanish from the run.
   */
  const spanX = Math.max(0, room.w - clearance * 2);
  const spanY = Math.max(0, room.h - clearance * 2);

  return {
    x: room.x + clearance + (spanX > 0 ? rng.range(0, spanX) : room.w / 2 - clearance),
    y: room.y + clearance + (spanY > 0 ? rng.range(0, spanY) : room.h / 2 - clearance),
  };
}

/** True when this point is on the floor of an enterable building. */
export function insideRoom(city: City, x: number, y: number): boolean {
  for (const room of city.rooms) {
    if (x >= room.x && x <= room.x + room.w && y >= room.y && y <= room.y + room.h) return true;
  }
  return false;
}
