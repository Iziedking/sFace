import { describe, expect, it } from 'vitest';
import { isAtlasCitizenPositionBlocked, projectAtlasCitizenMotion, resolveAtlasCitizenSpacing, routeAtlasCitizenPath } from '../shared/atlas/city/citizen-motion';
import type { AtlasCityCollider, AtlasCityPath } from '../shared/atlas/city/types';

const street: AtlasCityPath = {
  id: 'uneven-street',
  points: [[0, 0, 0], [1, 0, 0], [1, 0, 4]],
  purpose: 'walk',
  speed: 1.8,
};

const building: AtlasCityCollider = {
  id: 'test-building',
  shape: 'box',
  position: [0, 1.5, 0],
  size: [2, 3, 2],
};

describe('purposeful Atlas citizen motion', () => {
  it('samples geometric street distance instead of moving faster across long segments', () => {
    const sample = projectAtlasCitizenMotion({
      active: true,
      activity: 'walking',
      elapsedSeconds: 2,
      phase: 0,
      path: street,
      spawn: [0, 0, 0],
    });
    expect(sample.position[0]).toBeCloseTo(1);
    expect(sample.position[2]).toBeCloseTo(0.58, 2);
    expect(sample.moving).toBe(true);
    expect(sample.pace).toBe('walk');
  });

  it('dwells at a destination before walking back', () => {
    const shortPath: AtlasCityPath = { ...street, points: [[0, 0, 0], [1, 0, 0]], speed: 1 };
    const sample = projectAtlasCitizenMotion({
      active: true,
      activity: 'walking',
      elapsedSeconds: 3,
      phase: 0,
      path: shortPath,
      spawn: [0, 0, 0],
    });
    expect(sample.position).toEqual([1, 0, 0]);
    expect(sample.moving).toBe(false);
    expect(sample.pace).toBe('idle');
  });

  it('keeps workers at their authored station and gives a courier a distinct run', () => {
    const stationary = projectAtlasCitizenMotion({
      active: true,
      activity: 'repairing',
      elapsedSeconds: 40,
      phase: 0.3,
      path: street,
      spawn: [3, 0, -2],
    });
    const courier = projectAtlasCitizenMotion({
      active: true,
      activity: 'jogging',
      elapsedSeconds: 1,
      phase: 0,
      path: street,
      spawn: [0, 0, 0],
    });
    expect(stationary).toMatchObject({ position: [3, 0, -2], moving: false, pace: 'idle' });
    expect(courier).toMatchObject({ moving: true, pace: 'run' });
    expect(courier.speedUnitsPerSecond).toBeGreaterThan(1.4);
  });

  it('keeps citizens out of each other and makes room for the player', () => {
    const overlapping = {
      position: [1, 0, 1] as const,
      headingRadians: 0,
      moving: true,
      pace: 'walk' as const,
      speedUnitsPerSecond: 0.72,
    };
    const separated = resolveAtlasCitizenSpacing(
      [
        { id: 'atlas-a', motion: overlapping },
        { id: 'atlas-b', motion: overlapping },
      ],
      { x: 1, z: 1.1 },
    );
    const citizenDistance = Math.hypot(
      separated[0]!.position[0] - separated[1]!.position[0],
      separated[0]!.position[2] - separated[1]!.position[2],
    );
    expect(citizenDistance).toBeGreaterThanOrEqual(0.52);
    for (const motion of separated) {
      expect(Math.hypot(motion.position[0] - 1, motion.position[2] - 1.1)).toBeGreaterThanOrEqual(0.48);
    }
  });

  it('resolves crowd spacing deterministically for the same frame', () => {
    const motion = {
      position: [0, 0, 0] as const,
      headingRadians: Math.PI,
      moving: true,
      pace: 'walk' as const,
      speedUnitsPerSecond: 0.68,
    };
    const input = [
      { id: 'atlas-left', motion },
      { id: 'atlas-right', motion },
    ];
    expect(resolveAtlasCitizenSpacing(input)).toEqual(resolveAtlasCitizenSpacing(input));
  });

  it('recovers an authored citizen spawn from inside a building footprint', () => {
    const trapped = {
      position: [0.4, 0, 0.2] as const,
      headingRadians: 0,
      moving: false,
      pace: 'idle' as const,
      speedUnitsPerSecond: 0,
    };
    const [recovered] = resolveAtlasCitizenSpacing([{ id: 'market-merchant', motion: trapped }], undefined, [building]);
    expect(Math.abs(recovered!.position[0]) >= 1.24 || Math.abs(recovered!.position[2]) >= 1.24).toBe(true);
  });

  it('does not let path motion tunnel through a building', () => {
    const crossing = {
      position: [2, 0, 0] as const,
      headingRadians: Math.PI / 2,
      moving: true,
      pace: 'walk' as const,
      speedUnitsPerSecond: 0.72,
    };
    const [blocked] = resolveAtlasCitizenSpacing(
      [{ id: 'street-walker', motion: crossing, previousPosition: { x: -2, z: 0 } }],
      undefined,
      [building],
    );
    expect(blocked!.position[0]).toBeLessThanOrEqual(-1.24);
    expect(Math.abs(blocked!.position[2])).toBeLessThan(1.24);
  });

  it('routes authored crowd paths around building footprints', () => {
    const routed = routeAtlasCitizenPath(
      { id: 'market-crossing', points: [[-3, 0, 0], [3, 0, 0]], purpose: 'walk', speed: 1 },
      [building],
    );
    expect(routed.points.length).toBeGreaterThan(2);
    for (let index = 1; index < routed.points.length; index += 1) {
      const from = routed.points[index - 1]!;
      const to = routed.points[index]!;
      for (let step = 0; step <= 20; step += 1) {
        const amount = step / 20;
        expect(isAtlasCitizenPositionBlocked({
          x: from[0] + (to[0] - from[0]) * amount,
          z: from[2] + (to[2] - from[2]) * amount,
        }, [building])).toBe(false);
      }
    }
  });

  it('does not rewrite a path that is already clear', () => {
    const path = { id: 'clear-path', points: [[-3, 0, 3], [3, 0, 3]] as const, purpose: 'walk' as const, speed: 1 };
    expect(routeAtlasCitizenPath(path, [building]).points).toEqual(path.points);
  });

  it('keeps crowd separation from pushing a citizen into a wall', () => {
    const nearWall = {
      position: [1.3, 0, 0] as const,
      headingRadians: 0,
      moving: true,
      pace: 'walk' as const,
      speedUnitsPerSecond: 0.72,
    };
    const separated = resolveAtlasCitizenSpacing(
      [
        { id: 'wall-left', motion: nearWall, previousPosition: { x: 1.3, z: 0 } },
        { id: 'wall-right', motion: { ...nearWall, position: [1.31, 0, 0] }, previousPosition: { x: 1.31, z: 0 } },
      ],
      undefined,
      [building],
    );
    for (const motion of separated) {
      expect(Math.abs(motion.position[0]) >= 1.24 || Math.abs(motion.position[2]) >= 1.24).toBe(true);
    }
  });
});
