/**
 * The fight at the last gate.
 *
 * Stage seven ended on its quietest note. Every attacker picked a ring at
 * random, so the defence thinned as you worked inward: the outermost band is
 * the longest circle and got the same share as the shortest one. You answered
 * the final question, passed the last wall, and crossed an empty floor to the
 * thing the campaign is named after.
 *
 * The ground inside the last wall was worse than thin, it was unreachable:
 * spotOutside and spotNearGap both place things outside a wall, and there is no
 * ring inside the innermost one to be outside of. So the one piece of ground
 * the whole stage is about was the only place in the level nothing could stand.
 */

import { describe, expect, it } from 'vitest';

import { practiceMission } from '../src/game/mission';
import { RunState } from '../src/game/state';
import type { RingCity } from '../src/game/rings';

const SEEDS = ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05'];

function finale(date: string) {
  const state = new RunState(practiceMission(date), 'sidearm', 7);
  if (!state.rings) throw new Error('stage 7 should be a ring city');
  return { state, rings: state.rings };
}

/** Distance from the centre, which is what every band is measured in. */
function radius(rings: RingCity, x: number, y: number): number {
  return Math.hypot(x - rings.cx, y - rings.cy);
}

/** Inside the innermost wall: the floor the core stands on. */
function inCoreBand(rings: RingCity, x: number, y: number): boolean {
  const wall = rings.rings[0]!;
  const r = radius(rings, x, y);
  return r > rings.coreRadius && r < wall.radius - wall.thickness;
}

/** On the approach to the last gate, or just through it. */
function atLastGate(rings: RingCity, x: number, y: number): boolean {
  const wall = rings.rings[0]!;
  const r = radius(rings, x, y);
  if (r < wall.radius - wall.thickness || r > wall.radius + wall.thickness + 520) return false;

  const angle = Math.atan2(y - rings.cy, x - rings.cx);
  let apart = Math.abs(angle - wall.gapAt) % (Math.PI * 2);
  if (apart > Math.PI) apart = Math.PI * 2 - apart;
  return apart <= 0.9;
}

describe('the last gate is defended', () => {
  it('puts attackers inside the final wall, where none could stand before', () => {
    /*
     * The one that matters. Nothing could be placed here at all, so the walk to
     * the objective was guaranteed to be unopposed on every seed.
     */
    for (const date of SEEDS) {
      const { state, rings } = finale(date);
      const inside = state.enemies.filter((e) => inCoreBand(rings, e.x, e.y));
      expect(inside.length, date).toBeGreaterThan(0);
    }
  });

  it('holds the final approach with a real share of the level', () => {
    for (const date of SEEDS) {
      const { state, rings } = finale(date);
      const holding = state.enemies.filter((e) => atLastGate(rings, e.x, e.y));
      // A third of the level is committed to the ending. Anything less and the
      // finale is quieter than the stage before it.
      expect(holding.length / state.enemies.length, date).toBeGreaterThan(0.2);
    }
  });

  it('leaves nothing standing on the core itself', () => {
    // The core is what the player came for. Spawning on top of it would put the
    // objective inside a body.
    for (const date of SEEDS) {
      const { state, rings } = finale(date);
      for (const enemy of state.enemies) {
        expect(radius(rings, enemy.x, enemy.y), date).toBeGreaterThan(rings.coreRadius);
      }
    }
  });

  it('still leaves attackers on the way in', () => {
    /*
     * A route that is empty until the end is its own kind of boring, and it
     * would also make the earlier gates pointless: nothing would be risked by
     * standing still to read one.
     */
    for (const date of SEEDS) {
      const { state, rings } = finale(date);
      const outerBands = state.enemies.filter((e) => {
        const wall = rings.rings[1];
        return wall ? radius(rings, e.x, e.y) > wall.radius : false;
      });
      expect(outerBands.length, date).toBeGreaterThan(state.enemies.length * 0.25);
    }
  });

  it('is the same defence for two players on one seed', () => {
    // Placement comes out of the level stream at construction rather than being
    // spawned on arrival, because this stage is one people stake NIM on.
    const a = finale('2026-08-03');
    const b = finale('2026-08-03');

    expect(a.state.enemies.map((e) => [Math.round(e.x), Math.round(e.y)])).toEqual(
      b.state.enemies.map((e) => [Math.round(e.x), Math.round(e.y)]),
    );
  });
});
