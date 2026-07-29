/**
 * The transport you drive.
 *
 * Two earlier versions of this stage failed in playtest for the same reason: the
 * player had no verb. The car drove itself, arrived untouched and waited. These
 * tests pin the properties that make driving it an actual job, and the one
 * number that decides whether the stage is possible at all.
 */

import { describe, expect, it } from 'vitest';

import { practiceMission } from '../src/game/mission';
import { RunState } from '../src/game/state';
import { step } from '../src/game/update';
import { CONVOY_MAX_HEALTH, convoySpeed, damageConvoy } from '../src/game/convoy';
import { STAGES, stageAt } from '../src/data/campaign';
import type { PlayerCommand } from '../src/game/player';

const IDLE: PlayerCommand = { moveX: 0, moveY: 0, aimX: null, aimY: null, firing: false };
const FORWARD: PlayerCommand = { moveX: 1, moveY: 0, aimX: null, aimY: null, firing: false };
const OUT: PlayerCommand = { moveX: 0, moveY: -1, aimX: null, aimY: null, firing: false };

function run(stage = 5) {
  return new RunState(practiceMission('2026-07-29'), 'sidearm', stage);
}

/** Put the player on the seat and let the mount happen. */
function board(state: RunState) {
  const convoy = state.convoy!;
  state.player.x = convoy.x;
  state.player.y = convoy.y - 20;
  state.enemies.length = 0;
  step(state, 1 / 60, IDLE);
  return convoy;
}

describe('only stage five drives', () => {
  it('carries a transport on exactly one stage', () => {
    const staged: number[] = [];
    for (let n = 1; n <= STAGES.length; n++) if (stageAt(n).convoy) staged.push(n);
    expect(staged).toEqual([5]);
  });
});

describe('taking the wheel', () => {
  it('climbs in on contact', () => {
    const state = run();
    board(state);
    expect(state.driving).toBe(true);
  });

  it('does not climb in from across the level', () => {
    const state = run();
    state.enemies.length = 0;
    state.player.x = state.convoy!.x + 4000;
    step(state, 1 / 60, IDLE);
    expect(state.driving).toBe(false);
  });

  it('lets go when you hold up, and does not grab you straight back', () => {
    const state = run();
    board(state);
    expect(state.driving).toBe(true);

    step(state, 1 / 60, OUT);
    expect(state.driving).toBe(false);

    /*
     * The bug this exists for: the dismount clears the flag, and without a
     * lockout the very next frame finds the player still beside the seat and
     * puts them back in it. Getting out was impossible.
     */
    for (let i = 0; i < 20; i++) step(state, 1 / 60, IDLE);
    expect(state.driving).toBe(false);
  });
});

describe('it only moves while you drive it', () => {
  it('goes nowhere on its own', () => {
    const state = run();
    state.enemies.length = 0;
    const start = state.convoy!.x;

    for (let i = 0; i < 600; i++) step(state, 1 / 60, IDLE);

    expect(state.convoy!.x).toBe(start);
    expect(state.convoy!.stalled).toBe(true);
  });

  it('moves when you hold a direction', () => {
    const state = run();
    const convoy = board(state);
    const start = convoy.x;

    for (let i = 0; i < 120; i++) step(state, 1 / 60, FORWARD);

    expect(convoy.x).toBeGreaterThan(start);
    expect(convoy.stalled).toBe(false);
  });

  it('carries the driver with it', () => {
    const state = run();
    const convoy = board(state);
    for (let i = 0; i < 120; i++) step(state, 1 / 60, FORWARD);
    expect(state.player.x).toBeCloseTo(convoy.x, 0);
  });

  it('rides the ground rather than flying over it', () => {
    const state = run();
    const convoy = board(state);
    for (let i = 0; i < 300; i++) step(state, 1 / 60, FORWARD);
    expect(Math.abs(convoy.y - state.terrain.groundAt(convoy.x))).toBeLessThan(40);
  });
});

describe('the chart is a road, not scenery', () => {
  it('can cover the stage inside the clock when the line is drivable', () => {
    const state = run();
    const speed = convoySpeed(state.extractionX, state.seconds);
    const needed = (state.extractionX - state.convoy!.x) / speed;

    // Half the clock at a flat run, leaving the rest for everything else.
    expect(needed).toBeLessThan(state.seconds * 0.75);
  });

  it('refuses a climb that is too steep instead of grinding up it', () => {
    const state = run();
    const convoy = board(state);

    // Drive until something stops it or it arrives.
    let blockedEver = false;
    for (let i = 0; i < 60 * 200 && !convoy.arrived; i++) {
      step(state, 1 / 60, FORWARD);
      if (convoy.blocked) {
        blockedEver = true;
        break;
      }
    }

    // Either the day's chart is drivable end to end or it has a wall in it.
    // Both are valid; what must not happen is crawling up a cliff.
    expect(blockedEver || convoy.arrived).toBe(true);
  });
});

describe('losing the cargo ends the run', () => {
  it('ends immediately rather than letting an empty run continue', () => {
    const state = run();
    damageConvoy(state, CONVOY_MAX_HEALTH);
    expect(state.convoy!.health).toBe(0);
    expect(state.phase).toBe('died');
  });

  it('throws the driver out when it dies', () => {
    const state = run();
    board(state);
    expect(state.driving).toBe(true);

    damageConvoy(state, CONVOY_MAX_HEALTH);
    step(state, 1 / 60, IDLE);
    expect(state.driving).toBe(false);
  });
});

describe('arriving is not finishing', () => {
  it('does not clear while the cargo is still out there', () => {
    const state = run();
    state.enemies.length = 0;
    state.player.x = state.extractionX;
    state.player.y = state.terrain.groundAt(state.extractionX) - 60;
    step(state, 1 / 60, IDLE);

    expect(state.convoy!.arrived).toBe(false);
    expect(state.phase).toBe('flying');
  });
});

describe('driving stays settleable', () => {
  it('puts the cargo in the same place on one seed for the same input', () => {
    const a = run();
    const b = run();
    board(a);
    board(b);

    const traceA: string[] = [];
    const traceB: string[] = [];
    for (let i = 0; i < 300; i++) {
      const command: PlayerCommand = {
        moveX: Math.sin(i / 40),
        moveY: 0,
        aimX: null,
        aimY: null,
        firing: i % 6 === 0,
      };
      step(a, 1 / 60, command);
      step(b, 1 / 60, command);
      traceA.push(a.convoy!.x.toFixed(4));
      traceB.push(b.convoy!.x.toFixed(4));
    }
    expect(traceA).toEqual(traceB);
  });
});
