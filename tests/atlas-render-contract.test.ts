import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AtlasSceneRenderer } from '../src/atlas/render/contracts';
import { createAtlasRenderer } from '../src/atlas/render/scene-graph';
import { PixiAtlasRenderer, type PixiRendererBackend } from '../src/atlas/render/pixi-renderer';
import { sortAtlasEntities } from '../src/atlas/render/scene-graph';
import { PAY_HARBOR_WORLD } from '../shared/atlas/districts/pay-harbor';
import { createAtlasState } from '../shared/atlas/state';
import { projectLivingWorld } from '../shared/atlas/living-world';

describe('Atlas renderer boundary', () => {
  it('pins PixiJS and keeps authority methods out of the renderer', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies: Record<string, string> };
    expect(pkg.dependencies['pixi.js']).toMatch(/^8\./);
    const keys: Array<keyof AtlasSceneRenderer> = ['initialize', 'loadDistrict', 'render', 'resize', 'releaseDistrict', 'destroy'];
    expect(keys).not.toContain('score' as keyof AtlasSceneRenderer);
  });

  it('sorts entities by world depth without changing the input array', () => {
    const entities = [
      { id: 'near', x: 0, y: 20, depth: 0 },
      { id: 'far', x: 0, y: 10, depth: 0 },
      { id: 'tie-break', x: 0, y: 10, depth: 2 },
    ];
    expect(sortAtlasEntities(entities)).toEqual(['far', 'tie-break', 'near']);
    expect(entities.map((entity) => entity.id)).toEqual(['near', 'far', 'tie-break']);
  });

  it('initializes, loads, renders, resizes, releases, and destroys through the injected backend', async () => {
    const calls: string[] = [];
    const backend: PixiRendererBackend = {
      initialize: async () => { calls.push('initialize'); },
      loadDistrict: async (districtId) => { calls.push(`load:${districtId}`); },
      render: (snapshot) => { calls.push(`render:${snapshot.districtId}`); },
      resize: (width, height, resolution) => { calls.push(`resize:${width}:${height}:${resolution}`); },
      releaseDistrict: async (districtId) => { calls.push(`release:${districtId}`); },
      destroy: async () => { calls.push('destroy'); },
    };
    const renderer = new PixiAtlasRenderer(backend);
    const snapshot = projectLivingWorld(PAY_HARBOR_WORLD, createAtlasState(PAY_HARBOR_WORLD.mission), 'waiting');
    const before = structuredClone(snapshot);
    await renderer.initialize({} as HTMLElement, { reducedMotion: true, resolution: 3 });
    await renderer.loadDistrict('pay-harbor');
    renderer.render(snapshot);
    renderer.resize(0, -4, 9);
    await renderer.releaseDistrict('pay-harbor');
    await renderer.destroy();
    expect(snapshot).toEqual(before);
    expect(calls).toEqual([
      'initialize',
      'load:pay-harbor',
      'render:pay-harbor',
      'resize:1:1:2',
      'release:pay-harbor',
      'destroy',
    ]);
  });

  it('falls back to the canvas renderer when Pixi initialization fails', async () => {
    const pixi = new PixiAtlasRenderer({
      initialize: async () => { throw new Error('WebGL unavailable'); },
      loadDistrict: async () => undefined,
      render: () => undefined,
      resize: () => undefined,
      releaseDistrict: async () => undefined,
      destroy: async () => undefined,
    });
    let fallbackInitialized = false;
    const fallback: AtlasSceneRenderer = {
      initialize: async () => { fallbackInitialized = true; },
      loadDistrict: async () => undefined,
      render: () => undefined,
      resize: () => undefined,
      releaseDistrict: async () => undefined,
      destroy: async () => undefined,
    };
    const renderer = createAtlasRenderer({ pixi, fallback });
    const host = {} as HTMLElement;
    await renderer.initialize(host, { reducedMotion: true, resolution: 1 });
    expect(fallbackInitialized).toBe(true);
    await renderer.destroy();
  });
});
