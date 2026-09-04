import { describe, expect, it } from 'vitest';
import { AtlasLivingCityController } from '../src/atlas/city/living-city-controller';
import { PAY_HARBOR_WORLD } from '../shared/atlas/districts/pay-harbor';
import { projectLivingWorld } from '../shared/atlas/living-world';
import { createAtlasState } from '../shared/atlas/state';

function timingHarness() {
  let nextFrame: ((timestamp: number) => void) | undefined;
  let tick = 0;
  const snapshot = projectLivingWorld(PAY_HARBOR_WORLD, createAtlasState(PAY_HARBOR_WORLD.mission), 'waiting');
  const controller = new AtlasLivingCityController({
    renderer: {
      loadDistrict: async () => undefined,
      releaseDistrict: async () => undefined,
      destroy: async () => undefined,
      resize: () => undefined,
      render: (frame) => { tick = frame.simulation.tick; },
    },
    frameLoop: {
      request: (callback) => { nextFrame = callback; return 1; },
      cancel: () => { nextFrame = undefined; },
    },
  });
  controller.present(snapshot);
  controller.start();
  return {
    controller,
    snapshot,
    seconds: () => tick / 30,
    frame(timestamp: number) {
      if (!nextFrame) throw new Error('No city frame was scheduled.');
      nextFrame(timestamp);
    },
  };
}

describe('city presentation timing', () => {
  it.each([30, 60, 90, 120])('keeps animation at real speed on a %i Hz display', async (hz) => {
    const scene = timingHarness();
    for (let frame = 0; frame <= hz * 10; frame += 1) scene.frame(frame * 1_000 / hz);
    expect(scene.seconds()).toBeCloseTo(10, 8);
    // Presentation must not advance the authoritative mission snapshot.
    expect(scene.snapshot.simulation.tick).toBe(0);
    await scene.controller.destroy();
  });

  it('preserves elapsed time across irregular frame intervals', async () => {
    const scene = timingHarness();
    let timestamp = 0;
    scene.frame(timestamp);
    for (let frame = 0; frame < 600; frame += 1) {
      timestamp += frame % 2 === 0 ? 11 : 22;
      scene.frame(timestamp);
    }
    expect(scene.seconds()).toBeCloseTo(timestamp / 1_000, 8);
    await scene.controller.destroy();
  });

  it('does not invent animation time on duplicate frames or catch up after suspension', async () => {
    const scene = timingHarness();
    scene.frame(0);
    scene.frame(0);
    expect(scene.seconds()).toBe(0);
    scene.frame(60_000);
    expect(scene.seconds()).toBeCloseTo(0.1, 8);
    expect(scene.controller.qualityTier()).toBe('balanced');
    scene.frame(60_000 + 1_000 / 60);
    expect(scene.seconds()).toBeCloseTo(0.1 + 1 / 60, 8);
    await scene.controller.destroy();
  });
});
