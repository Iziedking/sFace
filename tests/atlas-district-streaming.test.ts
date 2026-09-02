import { describe, expect, it, vi } from 'vitest';
import { createAtlasAssetManager } from '../src/atlas/assets/asset-manager';
import { createAtlasDistrictRouter } from '../src/atlas/app/district-router';
import { createBeaconCommonsScene } from '../src/atlas/scenes/beacon-commons';
import type { AtlasAssetManifest } from '../src/atlas/assets/manifest';

const manifest: AtlasAssetManifest = {
  version: 1,
  mobileBudgetBytes: 262_144,
  assets: [
    { id: 'current', path: '/current', sha256: 'a'.repeat(64), bytes: 100, compressedBytes: 50, mime: 'application/json', width: 1, height: 1, bundle: 'genesis-garden' },
    { id: 'hub', path: '/hub', sha256: 'b'.repeat(64), bytes: 100, compressedBytes: 50, mime: 'application/json', width: 1, height: 1, bundle: 'beacon-commons' },
    { id: 'next', path: '/next', sha256: 'c'.repeat(64), bytes: 100, compressedBytes: 50, mime: 'application/json', width: 1, height: 1, bundle: 'pay-harbor' },
  ],
};

function setup(options: { load?: (bundle: string, quality: 'mobile' | 'full') => Promise<void>; manifestVersion?: number } = {}) {
  const load = options.load ?? vi.fn(async () => undefined);
  const unload = vi.fn(async () => undefined);
  const assets = createAtlasAssetManager({ load, unload }, { manifest, expectedManifestVersion: options.manifestVersion ?? 1 });
  const router = createAtlasDistrictRouter({ assets, initialDistrictId: 'genesis-garden', hubDistrictId: 'beacon-commons' });
  return { load, unload, assets, router };
}

describe('NIM Atlas streamed district transport', () => {
  it('keeps current, hub, and next bundle ownership explicit during travel', async () => {
    const { assets, router } = setup();
    await router.initialize();
    const travel = router.travel('pay-harbor');

    expect(router.state()).toEqual({ phase: 'preparing', from: 'genesis-garden', to: 'pay-harbor' });
    expect(assets.references('genesis-garden')).toBe(1);
    expect(assets.references('beacon-commons')).toBe(1);
    expect(assets.references('pay-harbor')).toBe(1);

    await travel;
    expect(router.state()).toEqual({ phase: 'arrived', districtId: 'pay-harbor' });
    expect(assets.references('genesis-garden')).toBe(0);
    expect(assets.references('beacon-commons')).toBe(1);
    expect(assets.references('pay-harbor')).toBe(1);
  });

  it('keeps the player in the current district when a bundle is unavailable', async () => {
    const { assets, router } = setup({ load: async (bundle) => {
      if (bundle === 'pay-harbor') throw new Error('network unavailable');
    } });
    await router.initialize();

    await expect(router.travel('pay-harbor')).rejects.toThrow('Atlas district travel failed.');
    expect(router.state()).toEqual({ phase: 'failed', districtId: 'genesis-garden', destination: 'pay-harbor', reason: 'asset-unavailable' });
    expect(assets.references('genesis-garden')).toBe(1);
    expect(assets.references('pay-harbor')).toBe(0);
  });

  it('can retry a failed destination after the stream becomes available', async () => {
    let available = false;
    const { router } = setup({ load: async (bundle) => {
      if (bundle === 'pay-harbor' && !available) throw new Error('offline');
    } });
    await router.initialize();
    await expect(router.travel('pay-harbor')).rejects.toThrow();
    available = true;

    await router.retry();
    expect(router.state()).toEqual({ phase: 'arrived', districtId: 'pay-harbor' });
  });

  it('selects the mobile bundle quality on low bandwidth', async () => {
    const load = vi.fn(async () => undefined);
    const { router } = setup({ load });
    await router.initialize({ bandwidth: 'low' });
    await router.travel('pay-harbor', { bandwidth: 'low' });

    expect(load).toHaveBeenCalledWith('genesis-garden', 'mobile');
    expect(load).toHaveBeenCalledWith('beacon-commons', 'mobile');
    expect(load).toHaveBeenCalledWith('pay-harbor', 'mobile');
  });

  it('rejects a stale manifest without replacing the current scene', async () => {
    const { assets, router } = setup({ manifestVersion: 2 });
    await expect(router.initialize()).rejects.toThrow('Atlas asset manifest is stale.');
    expect(router.state()).toEqual({ phase: 'idle', districtId: 'genesis-garden' });
    expect(assets.references('genesis-garden')).toBe(0);
  });

  it('does not report arrival before the destination assets are ready', async () => {
    let resolveLoad!: () => void;
    const destinationReady = new Promise<void>((resolve) => { resolveLoad = resolve; });
    const { router } = setup({ load: async (bundle) => {
      if (bundle === 'pay-harbor') await destinationReady;
    } });
    await router.initialize();
    const travel = router.travel('pay-harbor');

    await Promise.resolve();
    expect(router.state()).toEqual({ phase: 'preparing', from: 'genesis-garden', to: 'pay-harbor' });
    resolveLoad();
    await travel;
    expect(router.state()).toEqual({ phase: 'arrived', districtId: 'pay-harbor' });
  });

  it('keeps Beacon Commons honest when shared verification is unavailable', () => {
    const scene = createBeaconCommonsScene({ sharedState: 'unavailable', verifiedContributorCount: 9, reducedMotion: true });

    expect(scene.personalSpace.available).toBe(true);
    expect(scene.passport.available).toBe(false);
    expect(scene.expeditionBoard.available).toBe(false);
    expect(scene.verifiedContributorCount).toBe(9);
    expect(scene.ambientMotionEnabled).toBe(false);
  });
});
