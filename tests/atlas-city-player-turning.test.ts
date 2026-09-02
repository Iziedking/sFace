import { describe, expect, it } from 'vitest';

import { createAtlasCityPlayer, stepAtlasCityPlayer } from '../shared/atlas/city/player';

const bounds = { minX: -50, maxX: 50, minZ: -50, maxZ: 50 };
const spawn = { x: 0, z: 0 };
const frame = 1 / 30;

function shortestTurn(from: number, to: number): number {
  const difference = to - from;
  return Math.abs(Math.atan2(Math.sin(difference), Math.cos(difference)));
}

function runNorthAtFullSpeed(): ReturnType<typeof createAtlasCityPlayer> {
  let player = createAtlasCityPlayer({ x: 0, z: 0, facing: 'up' });
  for (let index = 0; index < 30; index += 1) {
    player = stepAtlasCityPlayer(player, { moveX: 0, moveY: -127, run: true }, frame, bounds, [], spawn);
  }
  return player;
}

describe('Atlas city player turning', () => {
  it('never turns more than the pace turn rate in a single frame during a full reversal', () => {
    // Measured before this was bounded: at the frame where velocity crossed
    // through zero, heading jumped a full pi radians while the player was still
    // moving at 0.113 units per second. Math.atan2 has no opinion about how
    // fast a body can rotate, so the ceiling has to be applied here.
    let player = runNorthAtFullSpeed();
    let previous = player.headingRadians;
    let largestTurn = 0;
    for (let index = 0; index < 60; index += 1) {
      player = stepAtlasCityPlayer(player, { moveX: 0, moveY: 127, run: true }, frame, bounds, [], spawn);
      largestTurn = Math.max(largestTurn, shortestTurn(previous, player.headingRadians));
      previous = player.headingRadians;
    }
    expect(largestTurn).toBeLessThanOrEqual(11 * frame + 0.0001);
  });

  it('still completes the reversal rather than locking the old heading', () => {
    let player = runNorthAtFullSpeed();
    for (let index = 0; index < 90; index += 1) {
      player = stepAtlasCityPlayer(player, { moveX: 0, moveY: 127, run: true }, frame, bounds, [], spawn);
    }
    expect(shortestTurn(player.headingRadians, 0)).toBeLessThan(0.05);
  });

  it('holds heading while idle', () => {
    let player = createAtlasCityPlayer({ x: 0, z: 0, facing: 'right' });
    const before = player.headingRadians;
    for (let index = 0; index < 10; index += 1) {
      player = stepAtlasCityPlayer(player, { moveX: 0, moveY: 0 }, frame, bounds, [], spawn);
    }
    expect(player.headingRadians).toBe(before);
  });

  it('turns more slowly at a run than at a walk', () => {
    // A body at speed cannot pivot, and that difference is most of what reads
    // as weight. Both cases start from the same heading and get the same
    // ninety degree flick, so the only variable is pace.
    function flickFrom(run: boolean): number {
      let player = createAtlasCityPlayer({ x: 0, z: 0, facing: 'up' });
      for (let index = 0; index < 30; index += 1) {
        player = stepAtlasCityPlayer(player, { moveX: 0, moveY: run ? -127 : -60, run }, frame, bounds, [], spawn);
      }
      const before = player.headingRadians;
      const after = stepAtlasCityPlayer(player, { moveX: run ? 127 : 60, moveY: 0, run }, frame, bounds, [], spawn);
      return shortestTurn(before, after.headingRadians);
    }
    expect(flickFrom(true)).toBeLessThan(flickFrom(false));
  });
});
