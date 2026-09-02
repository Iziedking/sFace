import { describe, expect, it, vi } from 'vitest';
import { AtlasLivingCityController } from '../src/atlas/city/living-city-controller';
import type { AtlasLivingWorldSnapshot } from '../shared/atlas/living-world';
import type { AtlasCitizenPresentation } from '../shared/atlas/city/crowd';
import type { AtlasCityPlayerState } from '../shared/atlas/city/player';

function renderer() {
  return {
    loadDistrict: vi.fn<(districtId: string) => Promise<void>>(async () => undefined),
    releaseDistrict: vi.fn<(districtId: string) => Promise<void>>(async () => undefined),
    render: vi.fn<(
      snapshot: AtlasLivingWorldSnapshot,
      crowd?: readonly AtlasCitizenPresentation[],
      player?: AtlasCityPlayerState,
    ) => void>(() => undefined),
    resize: vi.fn(),
    setQuality: vi.fn(),
    stats: vi.fn(() => ({ drawCalls: 1, triangles: 10 })),
    destroy: vi.fn(async () => undefined),
  };
}

function frameLoop() {
  let next = 0;
  const callbacks = new Map<number, (timestamp: number) => void>();
  return {
    callbacks,
    request: vi.fn((callback: (timestamp: number) => void) => { const handle = next; next += 1; callbacks.set(handle, callback); return handle; }),
    cancel: vi.fn((handle: number) => { callbacks.delete(handle); }),
  };
}

describe('living city controller', () => {
  it('owns exactly one frame loop and renders the latest snapshot', async () => {
    const fakeRenderer = renderer();
    const loop = frameLoop();
    const controller = new AtlasLivingCityController({ renderer: fakeRenderer, frameLoop: loop });
    controller.start();
    controller.start();
    controller.present({
      districtId: 'pay-harbor',
      restoration: 'waiting',
      player: {} as never,
      simulation: { tick: 1 } as never,
      entities: [],
    } as unknown as AtlasLivingWorldSnapshot);
    expect(loop.request).toHaveBeenCalledTimes(1);
    const callback = [...loop.callbacks.values()][0]!;
    callback(16);
    expect(fakeRenderer.render).toHaveBeenCalledTimes(1);
    expect(fakeRenderer.render.mock.calls[0]?.[2]).toMatchObject({ x: 0, z: 4.2, moving: false });
    expect(loop.request).toHaveBeenCalledTimes(2);
    await controller.destroy();
    expect(loop.cancel).toHaveBeenCalledTimes(1);
    expect(fakeRenderer.destroy).toHaveBeenCalledTimes(1);
  });

  it('moves the player and advances city animation from one frame loop', async () => {
    const fakeRenderer = renderer();
    const loop = frameLoop();
    const controller = new AtlasLivingCityController({
      renderer: fakeRenderer,
      frameLoop: loop,
      sampleMovement: () => ({ moveX: 127, moveY: 0 }),
    });
    controller.present({
      districtId: 'pay-harbor', restoration: 'waiting', player: {} as never,
      simulation: { tick: 0 } as never, entities: [],
    } as AtlasLivingWorldSnapshot);
    controller.start();
    [...loop.callbacks.values()][0]!(16);
    [...loop.callbacks.values()][1]!(49);
    expect(controller.playerSnapshot().x).toBeGreaterThan(0);
    expect(fakeRenderer.render.mock.calls[1]![0].simulation.tick).toBeGreaterThan(0);
    await controller.destroy();
  });

  it('orbits manually and then recenters behind a moving player', async () => {
    const fakeRenderer = renderer();
    const loop = frameLoop();
    let movement = { moveX: 127, moveY: 0 };
    const controller = new AtlasLivingCityController({
      renderer: fakeRenderer,
      frameLoop: loop,
      sampleMovement: () => movement,
    });
    controller.orbitCamera(-Math.PI / 2);
    expect(controller.playerSnapshot().cameraHeadingRadians).toBeCloseTo(Math.PI / 2);
    controller.start();
    let timestamp = 0;
    for (let frame = 0; frame < 28; frame += 1) {
      timestamp += 100;
      const callback = [...loop.callbacks.values()].at(-1)!;
      callback(timestamp);
      if (frame === 5) movement = { moveX: 0, moveY: 0 };
    }
    const player = controller.playerSnapshot();
    expect(Math.abs(player.cameraHeadingRadians - player.headingRadians)).toBeLessThan(0.2);
    await controller.destroy();
  });

  it('refreshes the living population when adaptive quality steps down', () => {
    const fakeRenderer = renderer();
    const controller = new AtlasLivingCityController({ renderer: fakeRenderer });
    controller.present({
      districtId: 'beacon-commons', restoration: 'waiting', player: {} as never,
      simulation: { tick: 0 } as never, entities: [],
    } as unknown as AtlasLivingWorldSnapshot);
    expect(controller.crowdSnapshot().filter((citizen) => citizen.visible)).toHaveLength(12);
    for (let second = 0; second < 5; second += 1) controller.recordFrameTime(38);
    expect(controller.qualityTier()).toBe('low');
    expect(controller.crowdSnapshot().filter((citizen) => citizen.visible)).toHaveLength(8);
  });

  it('swaps district ownership only after the next district loads', async () => {
    const fakeRenderer = renderer();
    const controller = new AtlasLivingCityController({ renderer: fakeRenderer, frameLoop: frameLoop() });
    await controller.activateDistrict('beacon-commons');
    await controller.activateDistrict('pay-harbor');
    expect(fakeRenderer.loadDistrict).toHaveBeenNthCalledWith(1, 'beacon-commons');
    expect(fakeRenderer.loadDistrict).toHaveBeenNthCalledWith(2, 'pay-harbor');
    expect(fakeRenderer.releaseDistrict).toHaveBeenCalledWith('beacon-commons');
    await controller.destroy();
    expect(fakeRenderer.releaseDistrict).toHaveBeenLastCalledWith('pay-harbor');
  });

  it('keeps the previous district when the next load fails', async () => {
    const fakeRenderer = renderer();
    fakeRenderer.loadDistrict.mockImplementationOnce(async () => undefined).mockRejectedValueOnce(new Error('offline'));
    const controller = new AtlasLivingCityController({ renderer: fakeRenderer, frameLoop: frameLoop() });
    await controller.activateDistrict('beacon-commons');
    await expect(controller.activateDistrict('pay-harbor')).rejects.toThrow('offline');
    expect(fakeRenderer.releaseDistrict).not.toHaveBeenCalled();
    await controller.destroy();
  });
});
