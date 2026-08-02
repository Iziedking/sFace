/**
 * The gun must not point at the floor.
 *
 * The fallback heading follows thrust, which is right in the air and wrong on
 * the ground. On a cramped landscape pad a resting thumb reads as a steady
 * downward push, so the gun tracked it into the dirt and stayed there. Reported
 * from the wallet as the gun facing downwards.
 */

import { describe, expect, it } from 'vitest';

import { practiceMission } from '../src/game/mission';
import { RunState } from '../src/game/state';
import { updatePlayer } from '../src/game/player';

const MISSION = practiceMission('2026-08-02');

function run(): RunState {
  return new RunState(MISSION, 'sidearm', 1);
}

function push(state: RunState, moveX: number, moveY: number): void {
  updatePlayer(state, 1 / 60, { moveX, moveY, aimX: null, aimY: null, firing: false });
}

/** Put the player on the deck, where a downward shot hits nothing. */
function ground(state: RunState): void {
  state.player.y = state.terrain.groundAt(state.player.x) - 8;
  state.player.vy = 0;
}

describe('the fallback heading', () => {
  it('does not aim down when there is no room below', () => {
    const state = run();
    ground(state);
    push(state, 0, 1);

    expect(state.player.aimY).toBeLessThanOrEqual(0.001);
  });

  it('keeps the sideways half of a diagonal push', () => {
    // Down and right on the stick should still shoot right.
    const state = run();
    ground(state);
    push(state, 1, 1);

    expect(state.player.aimX).toBeGreaterThan(0.5);
    expect(state.player.aimY).toBeLessThanOrEqual(0.001);
  });

  it('falls back to the way the character faces when pushed straight down', () => {
    const state = run();
    ground(state);
    state.player.facing = -1;
    push(state, 0, 1);

    expect(state.player.aimX).toBeLessThan(0);
    expect(state.player.aimY).toBeLessThanOrEqual(0.001);
  });

  it('still aims down when there is air to shoot into', () => {
    /*
     * The correction is about the floor, not about downward shots. High above
     * the ground, aiming down at something below is exactly what the player
     * meant and must keep working.
     */
    const state = run();
    state.player.y = state.terrain.groundAt(state.player.x) - 500;
    push(state, 0, 1);

    expect(state.player.aimY).toBeGreaterThan(0.5);
  });

  it('leaves an explicit aim alone', () => {
    // Pointing at the ground on purpose, with the fire pad, is still allowed.
    const state = run();
    ground(state);
    updatePlayer(state, 1 / 60, {
      moveX: 0,
      moveY: 0,
      aimX: state.player.x,
      aimY: state.player.y + 400,
      firing: false,
    });

    expect(state.player.aimY).toBeGreaterThan(0);
  });
});
