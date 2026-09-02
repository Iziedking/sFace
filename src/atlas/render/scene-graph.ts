import type { AtlasSceneRenderer, AtlasRendererOptions } from './contracts';
import type { AtlasCityInteractionPresentation } from './contracts';
import { FallbackAtlasRenderer } from './fallback-renderer';
import { PixiAtlasRenderer } from './pixi-renderer';
import { ThreeAtlasRenderer } from './three/three-renderer';
import type { AtlasWorldEntity } from '../../../shared/atlas/living-world';
import type { AtlasCitizenPresentation } from '../../../shared/atlas/city/crowd';
import type { AtlasCityPlayerState } from '../../../shared/atlas/city/player';

export function sortAtlasEntities<T extends Pick<AtlasWorldEntity, 'id' | 'y' | 'depth'>>(entities: readonly T[]): string[] {
  return [...entities]
    .sort((left, right) => left.y + left.depth - (right.y + right.depth) || left.id.localeCompare(right.id))
    .map((entity) => entity.id);
}

export interface AtlasRendererFactories {
  three?: AtlasSceneRenderer;
  pixi?: AtlasSceneRenderer;
  fallback?: AtlasSceneRenderer;
}

export function createAtlasRenderer(factories: AtlasRendererFactories = {}): AtlasSceneRenderer {
  return new ResilientAtlasRenderer(
    factories.three ?? new ThreeAtlasRenderer(),
    factories.pixi ?? new PixiAtlasRenderer(),
    factories.fallback ?? new FallbackAtlasRenderer(),
  );
}

class ResilientAtlasRenderer implements AtlasSceneRenderer {
  private active: AtlasSceneRenderer | null = null;

  constructor(
    private readonly three: AtlasSceneRenderer,
    private readonly pixi: AtlasSceneRenderer,
    private readonly fallback: AtlasSceneRenderer,
  ) {}

  async initialize(host: HTMLElement, options: AtlasRendererOptions): Promise<void> {
    const normalized = normalizeOptions(options);
    for (const renderer of [this.three, this.pixi, this.fallback]) {
      try {
        await renderer.initialize(host, normalized);
        this.active = renderer;
        return;
      } catch (error) {
        await renderer.destroy().catch(() => undefined);
        if (renderer === this.fallback) {
          throw new Error(`NIM Atlas could not initialize a renderer: ${error instanceof Error ? error.message : 'unknown renderer error'}`);
        }
      }
    }
  }

  async loadDistrict(districtId: string): Promise<void> {
    await this.requireActive().loadDistrict(districtId);
  }

  render(snapshot: Parameters<AtlasSceneRenderer['render']>[0], crowd: readonly AtlasCitizenPresentation[] = [], player?: AtlasCityPlayerState, interaction?: AtlasCityInteractionPresentation): void {
    this.requireActive().render(snapshot, crowd, player, interaction);
  }

  resize(width: number, height: number, resolution: number): void {
    this.requireActive().resize(width, height, resolution);
  }

  setQuality(tier: Parameters<NonNullable<AtlasSceneRenderer['setQuality']>>[0]): void {
    this.requireActive().setQuality?.(tier);
  }

  stats(): NonNullable<AtlasSceneRenderer['stats']> extends (...args: never[]) => infer Result ? Result : never {
    return this.requireActive().stats?.() ?? {
      kind: 'canvas',
      drawCalls: 0,
      triangles: 0,
      geometries: 0,
      textures: 0,
    };
  }

  async releaseDistrict(districtId: string): Promise<void> {
    await this.requireActive().releaseDistrict(districtId);
  }

  async destroy(): Promise<void> {
    if (this.active) await this.active.destroy();
    this.active = null;
  }

  private requireActive(): AtlasSceneRenderer {
    if (!this.active) throw new Error('NIM Atlas renderer is not initialized.');
    return this.active;
  }
}

function normalizeOptions(options: AtlasRendererOptions): AtlasRendererOptions {
  return {
    reducedMotion: options.reducedMotion,
    resolution: clampFinite(options.resolution, 1, 2),
    qualityTier: options.qualityTier,
    maxPixelRatio: clampFinite(options.maxPixelRatio ?? options.resolution, 0.5, 2),
    assetManager: options.assetManager,
  };
}

function clampFinite(value: number, minimum: number, maximum: number): number {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : minimum;
}
