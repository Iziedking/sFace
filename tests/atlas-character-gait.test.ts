import { describe, expect, it } from 'vitest';
import { advanceAtlasGait, atlasGaitFoot, atlasGaitStride, solveAtlasLeg } from '../shared/atlas/city/character-gait';

describe('distance-driven character gait', () => {
  it('keeps the straight-line stance foot stationary in world space', () => {
    const length = 0.732, scale = 0.72, speed = 1.15;
    const seconds = 0.05;
    const phase = 0.1;
    const advance = speed * seconds / (scale * atlasGaitStride(length, 0));
    const first = atlasGaitFoot(phase, length, 0);
    const next = atlasGaitFoot(phase + advance, length, 0);
    expect(first.planted && next.planted).toBe(true);
    expect(speed * seconds + (next.forward - first.forward) * scale).toBeCloseTo(0, 8);
    expect(next.lift).toBe(0);
  });
  it('advances the same distance phase at 30, 60 and 120 Hz', () => {
    const phases = [30, 60, 120].map((hz) => {
      let state = { phase: 0, amount: 1, runBlend: 0 };
      for (let frame = 0; frame < hz * 10; frame++) state = advanceAtlasGait(state, 1 / hz, 1.15, 0.72, 0.732, false);
      return state.phase;
    });
    expect(phases[0]).toBeCloseTo(phases[1]!, 8);
    expect(phases[0]).toBeCloseTo(phases[2]!, 8);
  });
  it('solves the ankle position instead of swinging a rigid leg', () => {
    for (const forward of [-0.22, 0, 0.22]) {
      const pose = solveAtlasLeg(0.378, 0.354, 0.65, forward);
      expect(0.378 * Math.cos(pose.hip) + 0.354 * Math.cos(pose.hip + pose.knee)).toBeCloseTo(0.65, 6);
      expect(-0.378 * Math.sin(pose.hip) - 0.354 * Math.sin(pose.hip + pose.knee)).toBeCloseTo(forward, 6);
      expect(pose.knee).toBeGreaterThan(0);
    }
  });
  it('freezes phase and eases the pose to rest when stopped', () => {
    let state = { phase: 0.3, amount: 1, runBlend: 1 };
    for (let i = 0; i < 120; i++) state = advanceAtlasGait(state, 1 / 60, 0, 0.72, 0.732, false);
    expect(state.phase).toBe(0.3);
    expect(state.amount).toBeLessThan(0.00001);
    expect(state.runBlend).toBeLessThan(0.00001);
  });
  it('keeps swing endpoints continuous and clamps unreachable leg targets', () => {
    const before = atlasGaitFoot(0.62 - 0.000001, 0.732, 0);
    const after = atlasGaitFoot(0.62 + 0.000001, 0.732, 0);
    expect(before.forward).toBeCloseTo(after.forward, 4);
    expect(after.lift).toBeLessThan(0.00001);
    const pose = solveAtlasLeg(0.378, 0.354, 100, 0);
    expect(Number.isFinite(pose.hip + pose.knee)).toBe(true);
    expect(() => solveAtlasLeg(0, 1, 0, 0)).toThrow();
  });
});
