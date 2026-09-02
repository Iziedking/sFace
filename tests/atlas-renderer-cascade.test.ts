import { describe, expect, it } from 'vitest';
import type { AtlasSceneRenderer, AtlasRendererOptions } from '../src/atlas/render/contracts';
import { createAtlasRenderer } from '../src/atlas/render/scene-graph';

function backend(name: string, events: string[], shouldFail: boolean): AtlasSceneRenderer {
  return {
    async initialize(): Promise<void> {
      events.push(`${name}:initialize`);
      if (shouldFail) throw new Error(`${name} unavailable`);
    },
    async loadDistrict(districtId: string): Promise<void> {
      events.push(`${name}:load:${districtId}`);
    },
    render(): void {
      events.push(`${name}:render`);
    },
    resize(): void {
      events.push(`${name}:resize`);
    },
    async releaseDistrict(districtId: string): Promise<void> {
      events.push(`${name}:release:${districtId}`);
    },
    async destroy(): Promise<void> {
      events.push(`${name}:destroy`);
    },
  };
}

describe('Atlas renderer cascade', () => {
  const options: AtlasRendererOptions = { reducedMotion: false, resolution: 1 };

  it('destroys failed Three before starting PixiJS', async () => {
    const events: string[] = [];
    const renderer = createAtlasRenderer({
      three: backend('three', events, true),
      pixi: backend('pixi', events, false),
      fallback: backend('canvas', events, false),
    });
    await renderer.initialize({} as HTMLElement, options);
    expect(events).toEqual(['three:initialize', 'three:destroy', 'pixi:initialize']);
    await renderer.destroy();
  });

  it('uses Canvas after Three and PixiJS both fail', async () => {
    const events: string[] = [];
    const renderer = createAtlasRenderer({
      three: backend('three', events, true),
      pixi: backend('pixi', events, true),
      fallback: backend('canvas', events, false),
    });
    await renderer.initialize({} as HTMLElement, options);
    expect(events).toEqual([
      'three:initialize',
      'three:destroy',
      'pixi:initialize',
      'pixi:destroy',
      'canvas:initialize',
    ]);
    await renderer.destroy();
  });

  it('does not expose authority methods on the renderer', () => {
    const renderer = createAtlasRenderer({
      three: backend('three', [], false),
      pixi: backend('pixi', [], false),
      fallback: backend('canvas', [], false),
    });
    expect('score' in renderer).toBe(false);
    expect('submitPayment' in renderer).toBe(false);
  });

  it('preserves the verified asset manager when normalizing renderer options', async () => {
    const assetManager = { loadBytes: async () => new ArrayBuffer(0) };
    const received: AtlasRendererOptions[] = [];
    const three = backend('three', [], false);
    three.initialize = async (_host, rendererOptions): Promise<void> => {
      received.push(rendererOptions);
    };
    const renderer = createAtlasRenderer({
      three,
      pixi: backend('pixi', [], false),
      fallback: backend('canvas', [], false),
    });

    await renderer.initialize({} as HTMLElement, { ...options, assetManager });

    expect(received[0]?.assetManager).toBe(assetManager);
    await renderer.destroy();
  });
});
