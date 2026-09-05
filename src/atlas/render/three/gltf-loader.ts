import { LoadingManager } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { AnimationClip, Group, Object3D } from 'three';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import type { AtlasAssetManager } from '../../assets/asset-manager';
import { cloneAtlasScene, disposeAtlasSceneResources } from './scene-instance';
import { refineAtlasCharacterSkin } from './character-skin';

export interface AtlasGltfHandle {
  readonly root: Object3D;
  readonly animations: readonly AnimationClip[];
  release(): void;
}

export type AtlasGltfDocument = { readonly scene: Group; readonly animations: readonly AnimationClip[] };
export type AtlasGltfParser = (bytes: ArrayBuffer, sourceUrl: string) => Promise<AtlasGltfDocument>;

export interface AtlasGltfLoaderOptions {
  readonly assetManager: Pick<AtlasAssetManager, 'loadBytes'>;
  readonly parser?: AtlasGltfParser;
}

interface LoadedResource {
  readonly gltf: AtlasGltfDocument;
  references: number;
  disposed: boolean;
}

export class AtlasGltfResourceCache {
  private readonly loaded = new Map<string, LoadedResource>();
  private readonly pending = new Map<string, Promise<LoadedResource>>();
  private readonly parser: AtlasGltfParser;

  constructor(private readonly options: AtlasGltfLoaderOptions) {
    this.parser = options.parser ?? parseWithThree;
  }

  async acquire(url: string): Promise<AtlasGltfHandle> {
    validateRuntimeUrl(url);
    const resource = await this.getOrLoad(url);
    resource.references += 1;
    const root = cloneAtlasScene(resource.gltf.scene);
    let released = false;
    return {
      root,
      animations: resource.gltf.animations,
      release: () => {
        if (released) return;
        released = true;
        root.parent?.remove(root);
        this.release(url, resource);
      },
    };
  }

  references(url: string): number {
    return this.loaded.get(url)?.references ?? 0;
  }

  pendingRequests(): number {
    return this.pending.size;
  }

  private async getOrLoad(url: string): Promise<LoadedResource> {
    const existing = this.loaded.get(url);
    if (existing) return existing;
    const pending = this.pending.get(url);
    if (pending) return pending;
    const request = this.load(url);
    this.pending.set(url, request);
    try {
      const resource = await request;
      this.loaded.set(url, resource);
      return resource;
    } finally {
      this.pending.delete(url);
    }
  }

  private async load(url: string): Promise<LoadedResource> {
    const bytes = await this.options.assetManager.loadBytes(url);
    const gltf = await this.parser(bytes, url);
    if (!gltf.scene) throw new Error(`GLB ${url} did not contain a scene.`);
    if (/^\/atlas\/3d\/v1\/characters\/atlas-walker-(player|npc-lod1)\.glb$/.test(url)) refineAtlasCharacterSkin(gltf.scene, url.endsWith('player.glb') ? 'player' : 'npc');
    return { gltf, references: 0, disposed: false };
  }

  private release(url: string, resource: LoadedResource): void {
    resource.references -= 1;
    if (resource.references > 0) return;
    if (!resource.disposed) {
      resource.disposed = true;
      disposeAtlasSceneResources(resource.gltf.scene);
    }
    this.loaded.delete(url);
  }
}

async function parseWithThree(bytes: ArrayBuffer, sourceUrl: string): Promise<GLTF> {
  const manager = new LoadingManager();
  manager.setURLModifier(() => {
    throw new Error(`External GLB dependency rejected for ${sourceUrl}.`);
  });
  const loader = new GLTFLoader(manager);
  return new Promise((resolve, reject) => {
    loader.parse(bytes, sourceUrl, resolve, reject);
  });
}

function validateRuntimeUrl(url: string): void {
  if (!url.startsWith('/atlas/') || url.includes('://') || url.split('/').includes('..')) {
    throw new Error('Atlas GLB URLs must be root-relative /atlas paths.');
  }
}
