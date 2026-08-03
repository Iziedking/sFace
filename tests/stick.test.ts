/**
 * How far the thumb has to move before the ship actually goes.
 *
 * This is the whole feel of the game on a phone, and it was quietly wrong. The
 * stick handed thrust to the ship in proportion to the thumb's distance from
 * where it landed, across a 64 pixel radius. A thumb does not travel 64 pixels
 * on a phone; it rocks maybe half that and steers by rolling.
 *
 * That would be a minor imprecision if thrust were a throttle, and it is not.
 * The ship's top speed is thrust divided by drag, so half a stick is half the
 * speed the ship can do, for as long as the thumb sits there. Normal play ran
 * at about half power with nothing on screen saying so, which is exactly what
 * "dragged and slow" describes.
 *
 * Nothing here throws if it regresses. The numbers below are the contract.
 */

import { describe, expect, it } from 'vitest';

import { STICK_FULL_TILT, stickMagnitude } from '../src/core/input';
import { parseRoster, practiceMission } from '../src/game/mission';
import { MAX_SPEED } from '../src/game/player';
import { RunState } from '../src/game/state';
import { step } from '../src/game/update';

describe('the stick curve', () => {
  it('gives nothing inside the deadzone', () => {
    // A thumb resting on the glass is not a direction.
    expect(stickMagnitude(0)).toBe(0);
    expect(stickMagnitude(7)).toBe(0);
  });

  it('reaches full power at a thumb\'s actual reach', () => {
    expect(stickMagnitude(STICK_FULL_TILT)).toBe(1);
    expect(STICK_FULL_TILT).toBeLessThanOrEqual(46);
  });

  it('never exceeds full power however hard it is pushed', () => {
    // Past the rim there is nothing left to give, and a magnitude over one
    // would out-thrust the ship's own limit.
    expect(stickMagnitude(200)).toBe(1);
  });

  it('gives most of the power for a modest push', () => {
    /*
     * The number that mattered. Twenty pixels out is an ordinary thumb rock,
     * and it used to be 31% thrust: a ship permanently at a third of its speed.
     */
    const modest = stickMagnitude(20);
    expect(modest).toBeGreaterThan(0.55);
    expect(modest).toBeLessThan(1);

    // What it used to be at the same deflection, for the record: distance over
    // a 64 pixel radius, no curve, no deadzone subtracted.
    expect(modest).toBeGreaterThan((20 / 64) * 1.7);
  });

  it('still rises with distance, so fine control exists', () => {
    // A curve that jumped straight to full would be a d-pad wearing a ring.
    const steps = [10, 16, 24, 32, 40].map(stickMagnitude);
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]!).toBeGreaterThan(steps[i - 1]!);
    }
  });
});

describe('what that does to the ship', () => {
  /**
   * Fly with a fixed stick deflection and report the fastest it ever goes.
   *
   * The peak rather than the speed at the end, because the chart is only so
   * wide: hold a direction long enough and the ship reaches the edge of the
   * world and stops, which measures the level rather than the throttle.
   */
  function topSpeed(distance: number): number {
    const state = new RunState(practiceMission('2026-07-29'), 'sidearm', 1);
    const power = stickMagnitude(distance);

    // Up and along, so gravity does not decide the answer.
    const command = { moveX: power, moveY: -power * 0.35, aimX: null, aimY: null, firing: false };

    let best = 0;
    for (let i = 0; i < 120; i++) {
      step(state, 1 / 60, command);
      best = Math.max(best, Math.hypot(state.player.vx, state.player.vy));
    }
    return best;
  }

  it('runs near its top speed on an ordinary push', () => {
    // Was about a third of top speed at this deflection, which is the bug.
    expect(topSpeed(20)).toBeGreaterThan(MAX_SPEED * 0.55);
  });

  it('runs at its top speed on a full push', () => {
    expect(topSpeed(STICK_FULL_TILT)).toBeGreaterThan(MAX_SPEED * 0.95);
  });

  it('can hover without a hair trigger', () => {
    /*
     * Gravity is 640 and thrust is 1750, so holding height takes 0.37 of full
     * power. If the curve reached that within a pixel or two of the deadzone
     * there would be no room to hold it steady, and the ship would flick
     * between climbing and dropping under a resting thumb.
     */
    const hover = 640 / 1750;
    const at = (d: number) => stickMagnitude(d);
    const crossing = [10, 11, 12, 13, 14, 15, 16].find((d) => at(d) >= hover);

    expect(crossing).toBeDefined();
    expect(crossing!).toBeGreaterThan(10);
  });

  it('does not move at all inside the deadzone', () => {
    // Falling is not moving under power, so this only checks the horizontal.
    const state = new RunState(practiceMission('2026-07-29'), 'sidearm', 1);
    const power = stickMagnitude(4);
    const command = { moveX: power, moveY: 0, aimX: null, aimY: null, firing: false };
    for (let i = 0; i < 120; i++) step(state, 1 / 60, command);

    expect(Math.abs(state.player.vx)).toBeLessThan(1);
  });
});

describe('carrying people', () => {
  it('never leaves more than one heavy person in a roster', () => {
    /*
     * The quirk comes from a model asked to pick one that suits the person, so
     * nothing on the wire stops it answering "heavy" for the whole cast. Each
     * one carried takes a slice of thrust, and thrust over drag is the ship's
     * top speed, so a heavy roster meant the ship wading for the whole run and
     * getting worse the more people were rescued.
     */
    const raw = Array.from({ length: 8 }, (_, i) => ({
      handle: `pilot${i}`,
      displayName: `@pilot${i}`,
      line: 'Still here.',
      quirk: 'heavy',
      bounty: 300,
    }));

    const roster = parseRoster(raw);
    expect(roster.filter((r) => r.quirk === 'heavy')).toHaveLength(1);
    // Demoted, not dropped. The person stays in the level.
    expect(roster).toHaveLength(8);
  });

  it('leaves a normal roster alone', () => {
    const raw = [
      { handle: 'a', displayName: '@a', line: 'x', quirk: 'heavy', bounty: 300 },
      { handle: 'b', displayName: '@b', line: 'x', quirk: 'paranoid', bounty: 300 },
      { handle: 'c', displayName: '@c', line: 'x', quirk: 'skittish', bounty: 300 },
    ];

    const roster = parseRoster(raw);
    expect(roster.slice(0, 3).map((r) => r.quirk)).toEqual(['heavy', 'paranoid', 'skittish']);
  });

  it('still flies with the heavy one aboard', () => {
    const state = new RunState(practiceMission('2026-07-29'), 'sidearm', 1);
    const heavy = state.faces.find((f) => f.quirk === 'heavy');
    if (heavy) {
      heavy.caged = false;
      heavy.state = 'following';
      heavy.slot = 0;
    }

    const command = { moveX: 1, moveY: -0.35, aimX: null, aimY: null, firing: false };
    let best = 0;
    for (let i = 0; i < 120; i++) {
      step(state, 1 / 60, command);
      best = Math.max(best, Math.hypot(state.player.vx, state.player.vy));
    }

    // A real cost, not a punishment for playing the game as intended.
    expect(best).toBeGreaterThan(MAX_SPEED * 0.7);
  });
});
