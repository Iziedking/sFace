import { describe, expect, it } from 'vitest';
import { cameraRelativeMovement, createAtlasCityPlayer, stepAtlasCityPlayer } from '../shared/atlas/city/player';

const bounds = { minX: -10, maxX: 10, minZ: -18, maxZ: 6 } as const;

describe('Atlas living-city player', () => {
  it('moves at the same speed on a diagonal and updates facing', () => {
    const start = createAtlasCityPlayer({ x: 0, z: 4.2, facing: 'up' });
    const straight = stepAtlasCityPlayer(start, { moveX: 127, moveY: 0 }, 0.1, bounds);
    const diagonal = stepAtlasCityPlayer(start, { moveX: 127, moveY: -127 }, 0.1, bounds);
    expect(straight.x).toBeGreaterThan(0);
    expect(straight.x).toBeLessThan(0.1);
    expect(Math.hypot(diagonal.x - start.x, diagonal.z - start.z)).toBeCloseTo(straight.x);
    expect(diagonal.facing).toBe('up');
    expect(diagonal.headingRadians).toBeCloseTo(Math.PI * 0.75);
    expect(diagonal.pace).toBe('walk');
    expect(diagonal.moving).toBe(true);
  });

  it('uses analog pressure for walking and full tilt for running', () => {
    const start = createAtlasCityPlayer({ x: 0, z: 4.2, facing: 'up' });
    let walking = start;
    let running = start;
    for (let index = 0; index < 10; index += 1) {
      walking = stepAtlasCityPlayer(walking, { moveX: 44, moveY: 0 }, 0.1, bounds);
      running = stepAtlasCityPlayer(running, { moveX: 127, moveY: 0 }, 0.1, bounds);
    }
    expect(walking.pace).toBe('walk');
    expect(running.pace).toBe('run');
    expect(walking.speed01).toBeGreaterThan(0);
    expect(running.x - start.x).toBeGreaterThan((walking.x - start.x) * 2);
  });

  it('uses run hysteresis so small thumb wobble does not switch gait every frame', () => {
    const start = createAtlasCityPlayer({ x: 0, z: 4.2, facing: 'up' });
    let running = start;
    for (let index = 0; index < 5; index += 1) running = stepAtlasCityPlayer(running, { moveX: 127, moveY: 0 }, 0.1, bounds);
    const stillRunning = stepAtlasCityPlayer(running, { moveX: 100, moveY: 0 }, 0.1, bounds);
    const walking = stepAtlasCityPlayer(stillRunning, { moveX: 80, moveY: 0 }, 0.1, bounds);
    expect(stillRunning.pace).toBe('run');
    expect(walking.pace).toBe('walk');
  });

  it('accelerates through a real walk before running and eases to a stop', () => {
    let player = createAtlasCityPlayer({ x: 0, z: 4.2, facing: 'up' });
    player = stepAtlasCityPlayer(player, { moveX: 127, moveY: 0 }, 0.1, bounds);
    expect(player.pace).toBe('walk');
    expect(player.speedUnitsPerSecond).toBeGreaterThan(0);
    expect(player.speedUnitsPerSecond).toBeLessThan(1);
    for (let index = 0; index < 5; index += 1) {
      player = stepAtlasCityPlayer(player, { moveX: 127, moveY: 0 }, 0.1, bounds);
    }
    expect(player.pace).toBe('run');
    expect(player.speedUnitsPerSecond).toBeGreaterThan(1.45);
    const beforeRelease = player.x;
    player = stepAtlasCityPlayer(player, { moveX: 0, moveY: 0 }, 0.1, bounds);
    expect(player.moving).toBe(true);
    expect(player.x).toBeGreaterThan(beforeRelease);
    for (let index = 0; index < 8; index += 1) {
      player = stepAtlasCityPlayer(player, { moveX: 0, moveY: 0 }, 0.1, bounds);
    }
    expect(player).toMatchObject({ moving: false, pace: 'idle', speedUnitsPerSecond: 0 });
  });

  it('keeps a continuous analog heading instead of snapping to four angles', () => {
    const start = createAtlasCityPlayer({ x: 0, z: 4.2, facing: 'up' });
    const next = stepAtlasCityPlayer(start, { moveX: 64, moveY: -127 }, 0.1, bounds);
    expect(next.headingRadians).toBeGreaterThan(Math.PI / 2);
    expect(next.headingRadians).toBeLessThan(Math.PI);
  });

  it('clamps the player to the walkable city bounds', () => {
    const start = createAtlasCityPlayer({ x: 9.9, z: -17.9, facing: 'right' });
    let next = start;
    for (let index = 0; index < 12; index += 1) next = stepAtlasCityPlayer(next, { moveX: 127, moveY: -127 }, 0.1, bounds);
    expect(next.x).toBe(10);
    expect(next.z).toBe(-18);
  });

  it('stops at simple building colliders without freezing the free axis', () => {
    const start = createAtlasCityPlayer({ x: 0, z: 1, facing: 'right' });
    const collider = { id: 'workshop', shape: 'box' as const, position: [2, 1, 0] as const, size: [2, 2, 2] as const };
    const next = stepAtlasCityPlayer(start, { moveX: 127, moveY: -64 }, 0.5, bounds, [collider]);
    expect(next.x).toBeLessThan(1);
    expect(next.z).toBeLessThan(1);
  });

  it('recovers an escaped player to the authored safe spawn even while idle', () => {
    const escaped = createAtlasCityPlayer({ x: -13.9, z: 8.4, facing: 'left' });
    const next = stepAtlasCityPlayer(escaped, { moveX: 0, moveY: 0 }, 1 / 30, bounds, [], { x: 0, z: 4.2 });
    expect(next).toMatchObject({ x: 0, z: 4.2, moving: false, pace: 'idle' });
  });

  it('converts the joystick into stable camera-relative street movement', () => {
    const streetForward = cameraRelativeMovement({ moveX: 0, moveY: -127 }, Math.PI);
    expect(streetForward.moveX).toBeCloseTo(0);
    expect(streetForward.moveY).toBeCloseTo(-127);
    const cameraFacingRight = cameraRelativeMovement({ moveX: 0, moveY: -127 }, Math.PI / 2);
    expect(cameraFacingRight.moveX).toBeCloseTo(127);
    expect(cameraFacingRight.moveY).toBeCloseTo(0);
  });
});
