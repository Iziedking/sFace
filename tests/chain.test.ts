/**
 * The line of people behind you.
 *
 * A rescued person follows a delayed copy of the path the ship flew. The delay
 * used to be counted in frames, which is a distance only while you are moving
 * at a constant speed. Slow down and the points bunch up. Stop, and every point
 * in the buffer is the spot you are standing on, so the whole chain converges
 * onto the ship and sits on it: a wall of faces around the player, on the stage
 * where you spend the most time on the ground.
 *
 * The failure never threw and never looked like a bug in a screenshot taken
 * while moving. It only shows up as "I cannot see myself and I cannot move",
 * which is why the tests here measure spacing rather than exercising a path.
 */

import { describe, expect, it } from 'vitest';

import { practiceMission } from '../src/game/mission';
import { RunState } from '../src/game/state';
import { TRAIL_STEP } from '../src/game/player';
import { step } from '../src/game/update';
import type { PlayerCommand } from '../src/game/player';

const IDLE: PlayerCommand = { moveX: 0, moveY: 0, aimX: null, aimY: null, firing: false };
const RIGHT: PlayerCommand = { moveX: 1, moveY: 0, aimX: null, aimY: null, firing: false };

/** Faces on this stage, freed and put in the chain in order. */
function withChain(count: number, stage = 1) {
  const state = new RunState(practiceMission('2026-07-29'), 'sidearm', stage);

  const chain = state.faces.slice(0, count);
  chain.forEach((face, slot) => {
    face.caged = false;
    face.state = 'following';
    face.slot = slot;
    face.fireCooldown = 0;
    // On top of the ship to begin with, which is the worst case: if the chain
    // cannot pull itself apart from here it cannot recover from a dive either.
    face.x = state.player.x;
    face.y = state.player.y;
  });

  return { state, chain };
}

function fly(state: RunState, command: PlayerCommand, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 60); i++) step(state, 1 / 60, command);
}

/** How close the nearest follower gets to the ship. */
function nearest(state: RunState, chain: Array<{ x: number; y: number }>): number {
  return Math.min(
    ...chain.map((f) => Math.hypot(f.x - state.player.x, f.y - state.player.y)),
  );
}

describe('the chain while moving', () => {
  it('strings out behind the ship rather than riding on it', () => {
    const { state, chain } = withChain(5);
    fly(state, RIGHT, 3);

    // Every one of them is behind, in slot order, and none is inside the ship.
    const gaps = chain.map((f) => state.player.x - f.x);
    expect(gaps.every((g) => g > 0)).toBe(true);
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]!).toBeGreaterThan(gaps[i - 1]!);
  });

  it('keeps them off each other', () => {
    const { state, chain } = withChain(5);
    fly(state, RIGHT, 3);

    for (let i = 1; i < chain.length; i++) {
      const gap = Math.hypot(chain[i]!.x - chain[i - 1]!.x, chain[i]!.y - chain[i - 1]!.y);
      // A face is 15 across the radius, so anything under a diameter is a pile.
      expect(gap).toBeGreaterThan(30);
    }
  });
});

describe('the chain while standing still', () => {
  it('does not collapse onto the player', () => {
    /*
     * The screenshot. Fly a while to build the line, then stop, which is what
     * happens every time you land to free somebody or read a gate. With a
     * frame-counted trail the whole chain arrived on top of the ship within a
     * second and a half, because that is how long the buffer was.
     */
    const { state, chain } = withChain(5);
    fly(state, RIGHT, 3);
    const before = nearest(state, chain);

    fly(state, IDLE, 3);
    const after = nearest(state, chain);

    expect(before).toBeGreaterThan(TRAIL_STEP);
    // It may settle a little as the springs finish, but it must not close in.
    expect(after).toBeGreaterThan(TRAIL_STEP);
  });

  it('holds the line it was in', () => {
    const { state, chain } = withChain(5);
    fly(state, RIGHT, 3);
    const settled = chain.map((f) => ({ x: f.x, y: f.y }));

    fly(state, IDLE, 4);

    // Gravity still applies on a chart stage, so they may sink to the ground.
    // What must not happen is them travelling to where the player is.
    for (let i = 0; i < chain.length; i++) {
      expect(Math.abs(chain[i]!.x - settled[i]!.x)).toBeLessThan(TRAIL_STEP * 2);
    }
  });
});

describe('the trail itself', () => {
  it('records by distance, not by frame', () => {
    const { state } = withChain(1);

    /*
     * Let it come to rest first.
     *
     * Idle is not stationary on a chart stage: with no thrust the ship falls,
     * and falling is real travel that belongs in the trail. What is being
     * measured here is a ship that has landed and is not going anywhere.
     */
    fly(state, IDLE, 3);
    const still = state.trail.length;

    fly(state, IDLE, 2);
    // Two seconds of standing there used to be 120 recorded points, every one
    // of them the same place, which is what dragged the chain onto the ship.
    expect(state.trail.length - still).toBeLessThanOrEqual(1);

    fly(state, RIGHT, 2);
    expect(state.trail.length).toBeGreaterThan(still + 2);
  });

  it('spaces its points about one step apart', () => {
    const { state } = withChain(1);
    fly(state, RIGHT, 3);

    for (let i = 1; i < Math.min(8, state.trail.length); i++) {
      const gap = Math.hypot(
        state.trail[i]!.x - state.trail[i - 1]!.x,
        state.trail[i]!.y - state.trail[i - 1]!.y,
      );
      expect(gap).toBeGreaterThanOrEqual(TRAIL_STEP);
      // A step plus one frame of travel at full speed, which is the most a
      // point can overshoot by.
      expect(gap).toBeLessThan(TRAIL_STEP + 12);
    }
  });
});
