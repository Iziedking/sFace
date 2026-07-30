/**
 * The city, which is the first world in this game that is not a corridor.
 *
 * Every other stage runs on one ground height per column, which is
 * mathematically a line: the only direction that means anything is forward.
 * These tests pin the properties that make this a place instead, and the one
 * that keeps it settleable.
 */

import { describe, expect, it } from 'vitest';

import { practiceMission } from '../src/game/mission';
import { RunState } from '../src/game/state';
import { step } from '../src/game/update';
import { lineBlocked, resolve, solidAt, WALL } from '../src/game/city';
import { PLAYER_RADIUS } from '../src/game/player';
import { CAR_RADIUS } from '../src/game/car';
import { STAGES, stageAt } from '../src/data/campaign';
import type { PlayerCommand } from '../src/game/player';

const IDLE: PlayerCommand = { moveX: 0, moveY: 0, aimX: null, aimY: null, firing: false };

function run(stage = 5) {
  return new RunState(practiceMission('2026-07-29'), 'sidearm', stage);
}

describe('which stages are cities', () => {
  it('is set on five and six and nowhere else', () => {
    // Both are cities, and they are not the same stage: five is the drive, six
    // is the read. Pinned so a city cannot spread to a stage whose mechanics
    // still assume a ground line.
    const cities: number[] = [];
    for (let n = 1; n <= STAGES.length; n++) if (stageAt(n).city) cities.push(n);
    expect(cities).toEqual([5, 6]);
  });

  it('is null on a chart run', () => {
    expect(run(1).city).toBeNull();
    expect(run(5).city).not.toBeNull();
  });
});

describe('it is a place, not a corridor', () => {
  it('is roughly square rather than a wide strip', () => {
    const city = run().city!;
    const ratio = city.width / city.height;
    // The first version was six to one, which is a corridor with side alleys.
    expect(ratio).toBeGreaterThan(0.6);
    expect(ratio).toBeLessThan(2.2);
  });

  it('has buildings with streets between them', () => {
    const city = run().city!;
    expect(city.blocks.length).toBeGreaterThan(20);

    /*
     * No two buildings may touch, or there is no street.
     *
     * An enterable building is four wall blocks in a ring, and those DO touch
     * each other at the corners, so a flat "nothing touches anything" check
     * fails on a city that has interiors without anything being wrong. The
     * property worth protecting is that two SEPARATE buildings never touch, so
     * blocks belonging to one ring are excused: a wall is part of a ring when it
     * sits inside that room's outer footprint.
     */
    const rings = city.rooms.map((room) => ({
      x: room.x - WALL,
      y: room.y - WALL,
      w: room.w + WALL * 2,
      h: room.h + WALL * 2,
    }));
    const ringOf = (b: { x: number; y: number; w: number; h: number }): number =>
      rings.findIndex(
        (r) => b.x >= r.x - 1 && b.y >= r.y - 1 && b.x + b.w <= r.x + r.w + 1 && b.y + b.h <= r.y + r.h + 1,
      );

    for (let i = 0; i < city.blocks.length; i++) {
      for (let j = i + 1; j < city.blocks.length; j++) {
        const a = city.blocks[i]!;
        const b = city.blocks[j]!;

        const sameRing = ringOf(a) !== -1 && ringOf(a) === ringOf(b);
        if (sameRing) continue;

        const apart =
          a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y;
        expect(apart).toBe(true);
      }
    }
  });

  it('starts and exits in the open, at opposite corners', () => {
    const city = run().city!;
    expect(solidAt(city, city.startX, city.startY)).toBe(false);
    expect(solidAt(city, city.exitX, city.exitY)).toBe(false);

    // Far apart in BOTH axes, so the route is a diagonal rather than a run.
    expect(Math.abs(city.exitX - city.startX)).toBeGreaterThan(city.width * 0.5);
    expect(Math.abs(city.exitY - city.startY)).toBeGreaterThan(city.height * 0.5);
  });
});

describe('you cannot walk through a building', () => {
  it('pushes a circle out of a wall', () => {
    const city = run().city!;
    const b = city.blocks[0]!;
    const pushed = resolve(city, b.x + b.w / 2, b.y + b.h / 2, 17);

    expect(pushed.hit).toBe(true);
    expect(solidAt(city, pushed.x, pushed.y)).toBe(false);
  });

  it('leaves a point in the street alone', () => {
    const city = run().city!;
    const pushed = resolve(city, city.startX, city.startY, 17);
    expect(pushed.hit).toBe(false);
    expect(pushed.x).toBe(city.startX);
  });

  it('keeps the player out of walls while driving into one', () => {
    const state = run();
    const city = state.city!;
    state.enemies.length = 0;

    // Head straight at the block nearest the start.
    for (let i = 0; i < 600; i++) {
      step(state, 1 / 60, { moveX: 1, moveY: -1, aimX: null, aimY: null, firing: false });
      expect(solidAt(city, state.player.x, state.player.y)).toBe(false);
    }
  });
});

describe('nothing is placed inside a wall', () => {
  it('puts every attacker, person and cache in the street', () => {
    const state = run();
    const city = state.city!;

    for (const enemy of state.enemies) expect(solidAt(city, enemy.x, enemy.y)).toBe(false);
    for (const face of state.faces) expect(solidAt(city, face.x, face.y)).toBe(false);
    for (const cache of state.caches) expect(solidAt(city, cache.x, cache.y)).toBe(false);
  });
});

describe('buildings are cover', () => {
  it('blocks a line that passes through one', () => {
    const city = run().city!;
    const b = city.blocks[0]!;
    const midY = b.y + b.h / 2;
    expect(lineBlocked(city, b.x - 200, midY, b.x + b.w + 200, midY)).toBe(true);
  });

  it('does not block a clear street', () => {
    const city = run().city!;
    // Along the top margin, which is street by construction.
    expect(lineBlocked(city, 20, 20, city.width - 20, 20)).toBe(false);
  });
});

describe('the city stays settleable', () => {
  it('builds the identical layout from one seed', () => {
    const a = run().city!;
    const b = run().city!;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('walks the same path from the same input', () => {
    const a = run();
    const b = run();
    const traceA: string[] = [];
    const traceB: string[] = [];

    for (let i = 0; i < 300; i++) {
      const command: PlayerCommand = {
        moveX: Math.sin(i / 30),
        moveY: Math.cos(i / 42),
        aimX: null,
        aimY: null,
        firing: i % 8 === 0,
      };
      step(a, 1 / 60, command);
      step(b, 1 / 60, command);
      traceA.push(`${a.player.x.toFixed(4)}:${a.player.y.toFixed(4)}`);
      traceB.push(`${b.player.x.toFixed(4)}:${b.player.y.toFixed(4)}`);
    }
    expect(traceA).toEqual(traceB);
    void IDLE;
  });
});

/**
 * Buildings you can walk into.
 *
 * Reported from a playtest as health you can see and cannot reach. The refills
 * were laid out AFTER the pass that relocates everything into the streets, so
 * they were the one thing in a city that kept its chart-run position, against a
 * ground line a city does not have. They ended up sealed inside walls.
 */
describe('interiors', () => {
  it('puts every refill somewhere a player can actually stand', () => {
    // The bug, stated as a test: a refill inside a wall can never be taken.
    for (const stage of [5, 6]) {
      const state = new RunState(practiceMission('2026-07-29'), 'sidearm', stage);
      const city = state.city!;
      expect(state.refills.length).toBeGreaterThan(0);

      for (const refill of state.refills) {
        expect(solidAt(city, refill.x, refill.y)).toBe(false);
        // And with the player's own body, not just as a point.
        expect(resolve(city, refill.x, refill.y, PLAYER_RADIUS).hit).toBe(false);
      }
    }
  });

  it('keeps refills inside the map', () => {
    const state = new RunState(practiceMission('2026-07-29'), 'sidearm', 5);
    const city = state.city!;
    for (const refill of state.refills) {
      expect(refill.x).toBeGreaterThan(0);
      expect(refill.y).toBeGreaterThan(0);
      expect(refill.x).toBeLessThan(city.width);
      expect(refill.y).toBeLessThan(city.height);
    }
  });

  it('opens up some buildings', () => {
    const city = run().city!;
    expect(city.rooms.length).toBeGreaterThan(0);
  });

  it('gives every room a floor clear of its own walls', () => {
    const city = run().city!;
    for (const room of city.rooms) {
      // The middle of the floor must be standable, or the room is decoration.
      expect(solidAt(city, room.x + room.w / 2, room.y + room.h / 2)).toBe(false);
    }
  });

  it('lets a person through the door and keeps the car out', () => {
    /*
     * The trade the whole feature rests on. If the car fits, the interiors are
     * just more road and walking never pays; if a person does not fit, the loot
     * inside is unreachable and we are back to the reported bug.
     */
    const city = run().city!;
    expect(city.rooms.length).toBeGreaterThan(0);

    for (const room of city.rooms) {
      const door = doorCentre(room);

      // A person standing in the doorway is not intersecting a wall.
      expect(resolve(city, door.x, door.y, PLAYER_RADIUS).hit).toBe(false);
      // The car is.
      expect(resolve(city, door.x, door.y, CAR_RADIUS).hit).toBe(true);
    }
  });

  it('leaves the doorway as the only way in', () => {
    // Walking at a room from the three other sides has to be refused, or the
    // walls are not walls and the door means nothing.
    const city = run().city!;
    for (const room of city.rooms) {
      const mid = { x: room.x + room.w / 2, y: room.y + room.h / 2 };
      const sides = {
        north: { x: mid.x, y: room.y - WALL / 2 },
        south: { x: mid.x, y: room.y + room.h + WALL / 2 },
        west: { x: room.x - WALL / 2, y: mid.y },
        east: { x: room.x + room.w + WALL / 2, y: mid.y },
      } as const;

      for (const [side, point] of Object.entries(sides)) {
        if (side === room.door) continue;
        expect(solidAt(city, point.x, point.y)).toBe(true);
      }
    }
  });
});

/** The middle of a room's doorway, in world units. */
function doorCentre(room: {
  x: number;
  y: number;
  w: number;
  h: number;
  door: 'north' | 'south' | 'east' | 'west';
}): { x: number; y: number } {
  switch (room.door) {
    case 'north':
      return { x: room.x + room.w / 2, y: room.y - WALL / 2 };
    case 'south':
      return { x: room.x + room.w / 2, y: room.y + room.h + WALL / 2 };
    case 'west':
      return { x: room.x - WALL / 2, y: room.y + room.h / 2 };
    case 'east':
      return { x: room.x + room.w + WALL / 2, y: room.y + room.h / 2 };
  }
}
