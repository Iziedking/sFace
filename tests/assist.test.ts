/**
 * Aim assist.
 *
 * Reported as shooting being difficult, which on a phone it genuinely was: the
 * right thumb has to hold a fire button and push a direction at a target the size
 * of a fingernail. The gun now bends toward what you were nearly pointing at.
 *
 * The cases that matter are the limits, not the help: it must never turn the gun
 * to something behind you, never help you shoot through a wall, and never differ
 * between two people with a bet riding on the same seed.
 */

import { describe, expect, it } from 'vitest';

import { practiceMission } from '../src/game/mission';
import { RunState } from '../src/game/state';
import { BASELINE_ASSIST, earnedAssist, steerAim } from '../src/game/assist';
import { solidAt } from '../src/game/city';

/** A chart run with exactly one attacker, placed where the test wants it. */
function withOne(x: number, y: number, stage = 1) {
  const state = new RunState(practiceMission('2026-07-30'), 'sidearm', stage);
  const enemy = state.enemies[0]!;
  state.enemies.length = 0;
  state.enemies.push(enemy);
  enemy.alive = true;
  enemy.x = x;
  enemy.y = y;
  return { state, enemy };
}

describe('bending the aim', () => {
  it('pulls a near miss toward the target', () => {
    const { state } = withOne(600, 500);
    state.player.x = 100;
    state.player.y = 500;
    state.assist = 3;

    // Pointing right, but a little high. The target is dead right.
    const off = Math.hypot(1, -0.12);
    const helped = steerAim(state, 1 / off, -0.12 / off);

    // Closer to horizontal than we asked for.
    expect(Math.abs(helped.y)).toBeLessThan(0.12);
  });

  it('leaves an aim alone when nothing is near it', () => {
    const { state } = withOne(600, 500);
    state.player.x = 100;
    state.player.y = 500;
    state.assist = 3;

    // Pointing away from the only target.
    const helped = steerAim(state, -1, 0);
    expect(helped.x).toBeCloseTo(-1, 5);
    expect(helped.y).toBeCloseTo(0, 5);
  });

  it('never turns the gun to something behind you', () => {
    // The property that keeps this an assist rather than an auto-shooter.
    const { state } = withOne(100, 500);
    state.player.x = 600;
    state.player.y = 500;
    state.assist = 3;

    const helped = steerAim(state, 1, 0);
    expect(helped.x).toBeGreaterThan(0.99);
  });

  it('does nothing at all when it is off', () => {
    const { state } = withOne(600, 500);
    state.player.x = 100;
    state.player.y = 500;
    state.assist = 0;

    const helped = steerAim(state, 1, -0.1);
    expect(helped.x).toBe(1);
    expect(helped.y).toBe(-0.1);
  });

  it('ignores the dead', () => {
    const { state, enemy } = withOne(600, 500);
    state.player.x = 100;
    state.player.y = 500;
    state.assist = 3;
    enemy.alive = false;

    const helped = steerAim(state, 1, -0.1);
    expect(helped.y).toBeCloseTo(-0.1, 5);
  });

  it('helps more at a higher tier', () => {
    const pull = (level: 1 | 2 | 3): number => {
      const { state } = withOne(600, 500);
      state.player.x = 100;
      state.player.y = 500;
      state.assist = level;
      const off = Math.hypot(1, -0.1);
      return Math.abs(steerAim(state, 1 / off, -0.1 / off).y);
    };

    // Less residual error at each step up.
    expect(pull(2)).toBeLessThan(pull(1));
    expect(pull(3)).toBeLessThan(pull(2));
  });

  it('never fully locks on, even at the top tier', () => {
    // A gun that snaps exactly onto a target removes the act of aiming.
    const { state } = withOne(600, 500);
    state.player.x = 100;
    state.player.y = 500;
    state.assist = 3;

    const off = Math.hypot(1, -0.1);
    const helped = steerAim(state, 1 / off, -0.1 / off);
    expect(Math.abs(helped.y)).toBeGreaterThan(0);
  });

  it('refuses to help through a wall', () => {
    // Otherwise cover stops bullets while the gun tracks the man behind it,
    // which is worse than no assist: it promises a shot that does not exist.
    const state = new RunState(practiceMission('2026-07-30'), 'sidearm', 5);
    const city = state.city!;
    state.assist = 3;

    const block = city.blocks[0]!;
    // Stand on one side of a building, put the target on the other.
    state.player.x = block.x - 60;
    state.player.y = block.y + block.h / 2;

    const enemy = state.enemies[0]!;
    state.enemies.length = 0;
    state.enemies.push(enemy);
    enemy.alive = true;
    enemy.x = block.x + block.w + 60;
    enemy.y = state.player.y;

    // Confirm the wall is actually between them before trusting the result.
    expect(solidAt(city, block.x + block.w / 2, state.player.y)).toBe(true);

    const helped = steerAim(state, 1, -0.05);
    expect(helped.y).toBeCloseTo(-0.05, 5);
  });
});

describe('what a player has earned', () => {
  it('gives a brand new player a working gun', () => {
    // The baseline is free on purpose: a first-timer on a phone must not meet
    // the least playable version of the game.
    expect(earnedAssist({ stagesCleared: 0 }, false)).toBe(BASELINE_ASSIST);
    expect(BASELINE_ASSIST).toBeGreaterThan(0);
  });

  it('raises the tier as the campaign is cleared', () => {
    expect(earnedAssist({ stagesCleared: 3 }, false)).toBe(2);
    expect(earnedAssist({ stagesCleared: 5 }, false)).toBe(3);
  });

  it('accepts clan wins or challenge wins instead of stages', () => {
    // Three routes to the same unlock, so nobody is locked out for having no
    // clan or nobody to play against.
    expect(earnedAssist({ stagesCleared: 0, clanWins: 1 }, false)).toBe(2);
    expect(earnedAssist({ stagesCleared: 0, challengeWins: 5 }, false)).toBe(3);
  });

  it('pins a staked run to the baseline at every level of progress', () => {
    // The fairness rule the whole design rests on: a bet is settled on who
    // played better today, not on who has been playing longer.
    for (const stagesCleared of [0, 3, 5, 7]) {
      expect(earnedAssist({ stagesCleared }, true)).toBe(BASELINE_ASSIST);
    }
    expect(earnedAssist({ stagesCleared: 7, clanWins: 9, challengeWins: 9 }, true)).toBe(
      BASELINE_ASSIST,
    );
  });
});

describe('determinism', () => {
  it('is a pure function of aim, targets and level', () => {
    // Two players who move identically must get identical aim, or a recorded
    // run stops replaying and a challenge stops settling.
    const once = () => {
      const { state } = withOne(600, 480);
      state.player.x = 100;
      state.player.y = 500;
      state.assist = 2;
      return steerAim(state, 1, -0.08);
    };
    expect(once()).toEqual(once());
  });
});
