import { AnimationClip, BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { AtlasGltfResourceCache } from '../src/atlas/render/three/gltf-loader';

function fixtureScene(): { scene: Group; geometry: BoxGeometry; material: MeshBasicMaterial } {
  const scene = new Group();
  const geometry = new BoxGeometry(1, 1, 1);
  const material = new MeshBasicMaterial();
  scene.add(new Mesh(geometry, material));
  return { scene, geometry, material };
}

describe('verified GLB resource cache', () => {
  it('shares concurrent fetch and parse work while isolating scene instances', async () => {
    let resolveBytes: (bytes: ArrayBuffer) => void = () => undefined;
    const loadBytes = vi.fn(() => new Promise<ArrayBuffer>((resolve) => { resolveBytes = resolve; }));
    const parse = vi.fn(async () => ({ ...fixtureScene(), animations: [new AnimationClip('idle', 1, [])] }));
    const cache = new AtlasGltfResourceCache({ assetManager: { loadBytes }, parser: parse });

    const firstRequest = cache.acquire('/atlas/3d/v1/characters/atlas-walker-player.glb');
    const secondRequest = cache.acquire('/atlas/3d/v1/characters/atlas-walker-player.glb');
    expect(loadBytes).toHaveBeenCalledTimes(1);
    resolveBytes(new ArrayBuffer(8));
    const [first, second] = await Promise.all([firstRequest, secondRequest]);

    expect(parse).toHaveBeenCalledTimes(1);
    expect(first.root).not.toBe(second.root);
    expect(cache.references('/atlas/3d/v1/characters/atlas-walker-player.glb')).toBe(2);
    const geometry = first.root.children[0] as Mesh;
    const geometryDispose = vi.spyOn(geometry.geometry, 'dispose');
    const materialDispose = vi.spyOn(geometry.material as MeshBasicMaterial, 'dispose');
    first.release();
    first.release();
    expect(cache.references('/atlas/3d/v1/characters/atlas-walker-player.glb')).toBe(1);
    expect(geometryDispose).not.toHaveBeenCalled();
    second.release();
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
  });

  it('clears failed requests so the next attempt can retry cleanly', async () => {
    const loadBytes = vi.fn(async () => new ArrayBuffer(8));
    const parse = vi.fn()
      .mockRejectedValueOnce(new Error('parse failed'))
      .mockImplementationOnce(async () => ({ ...fixtureScene(), animations: [] }));
    const cache = new AtlasGltfResourceCache({ assetManager: { loadBytes }, parser: parse });
    const url = '/atlas/3d/v1/characters/atlas-walker-npc-lod1.glb';

    await expect(cache.acquire(url)).rejects.toThrow('parse failed');
    expect(cache.pendingRequests()).toBe(0);
    const handle = await cache.acquire(url);
    expect(loadBytes).toHaveBeenCalledTimes(2);
    expect(parse).toHaveBeenCalledTimes(2);
    handle.release();
  });

  it('rejects non-runtime URLs before touching the asset manager', async () => {
    const loadBytes = vi.fn(async () => new ArrayBuffer(8));
    const cache = new AtlasGltfResourceCache({ assetManager: { loadBytes }, parser: async () => ({ ...fixtureScene(), animations: [] }) });

    await expect(cache.acquire('https://example.com/city.glb')).rejects.toThrow('root-relative /atlas paths');
    await expect(cache.acquire('/atlas/../city.glb')).rejects.toThrow('root-relative /atlas paths');
    expect(loadBytes).not.toHaveBeenCalled();
  });
});
