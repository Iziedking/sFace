import type { AtlasLivingWorldSnapshot } from '../../../shared/atlas/living-world';
import type { AtlasQualityTier } from '../../../shared/atlas/city/types';
import type { AtlasCitizenPresentation } from '../../../shared/atlas/city/crowd';
import type { AtlasAssetManager } from '../assets/asset-manager';
import type { AtlasCityPlayerState } from '../../../shared/atlas/city/player';

export interface AtlasRendererOptions {
  reducedMotion: boolean;
  resolution: number;
  qualityTier?: AtlasQualityTier;
  maxPixelRatio?: number;
  assetManager?: Pick<AtlasAssetManager, 'loadBytes'>;
}

export type AtlasRendererKind = 'three' | 'pixi' | 'canvas';

export interface AtlasRendererStats {
  readonly kind: AtlasRendererKind;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly geometries: number;
  readonly textures: number;
}

export interface AtlasCityInteractionPresentation {
  readonly districtId: string;
  readonly relayCarried: boolean;
  readonly builderStationIndex: number;
  readonly targetAnchorId?: string;
}

export interface AtlasSceneRenderer {
  initialize(host: HTMLElement, options: AtlasRendererOptions): Promise<void>;
  loadDistrict(districtId: string): Promise<void>;
  render(snapshot: AtlasLivingWorldSnapshot, crowd?: readonly AtlasCitizenPresentation[], player?: AtlasCityPlayerState, interaction?: AtlasCityInteractionPresentation): void;
  resize(width: number, height: number, resolution: number): void;
  setQuality?(tier: AtlasQualityTier): void;
  /*
   * Which path the player chose.
   *
   * Every citizen shares the player's model and a playtester could not tell
   * which figure was theirs, so the renderer marks the player with a ground
   * ring in their path's colour. Separate from the interaction presentation
   * because identity is not interaction: Beacon Commons deliberately clears
   * that presentation, and the player is still the player there.
   */
  setPlayerRole?(role: 'explorer' | 'builder'): void;
  stats?(): AtlasRendererStats;
  releaseDistrict(districtId: string): Promise<void>;
  destroy(): Promise<void>;
}
