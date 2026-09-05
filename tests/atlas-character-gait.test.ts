import { describe, expect, it } from 'vitest';
import { advanceAtlasGait, atlasGaitArm, atlasGaitBody, atlasGaitFoot, atlasGaitStride, solveAtlasLeg } from '../shared/atlas/city/character-gait';

describe('distance-driven character gait', () => {
  it('keeps the stance foot substantially steadier than the moving body', () => {
    const length = 0.732, scale = 0.72, speed = 1.15;
    const seconds = 0.05;
    const phase = 0.1;
    const advance = speed * seconds / (scale * atlasGaitStride(length, 0));
    const first = atlasGaitFoot(phase, length, 0);
    const next = atlasGaitFoot(phase + advance, length, 0);
    expect(first.planted && next.planted).toBe(true);
    const plantedSlip = speed * seconds + (next.forward - first.forward) * scale;
    expect(Math.abs(plantedSlip)).toBeLessThan(speed * seconds * 0.6);
    expect(next.lift).toBe(0);
  });

  it('uses a human walking cadence instead of taking four short steps per second', () => {
    const cycleDistance = atlasGaitStride(0.732, 0) * 0.72;
    const cyclesPerSecond = 1.15 / cycleDistance;
    expect(cyclesPerSecond).toBeGreaterThan(0.75);
    expect(cyclesPerSecond).toBeLessThan(1.1);
  });

  it('counter-swings each arm against its same-side leg', () => {
    const left = atlasGaitArm(0, 0, 1);
    const right = atlasGaitArm(0.5, 0, 1);
    expect(left.shoulderPitch).toBeLessThan(0);
    expect(right.shoulderPitch).toBeGreaterThan(0);
    expect(left.shoulderPitch).toBeCloseTo(-right.shoulderPitch, 6);
  });

  it('shifts weight through the pelvis and counters it through the chest', () => {
    const body = atlasGaitBody(0.25, 0.732, 0, 1);
    const runningBody = atlasGaitBody(0.25, 0.732, 1, 1);
    expect(body.sway).toBeGreaterThan(0);
    expect(body.pelvisRoll).toBeGreaterThan(0);
    expect(body.pelvisYaw * body.chestYaw).toBeLessThan(0);
    expect(body.drop).toBeLessThan(0.732 * 0.08);
    expect(runningBody.drop).toBeGreaterThan(body.drop);
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
    expect(atlasGaitFoot(0.8, 0.732, 0).pitch).toBeGreaterThan(0);
    const pose = solveAtlasLeg(0.378, 0.354, 100, 0);
    expect(Number.isFinite(pose.hip + pose.knee)).toBe(true);
    expect(() => solveAtlasLeg(0, 1, 0, 0)).toThrow();
  });
});
