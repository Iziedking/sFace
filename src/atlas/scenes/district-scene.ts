import { createAtlasState } from '../../../shared/atlas/state';
import { projectLivingWorld, type AtlasLivingWorldDefinition, type AtlasRestorationState } from '../../../shared/atlas/living-world';

export interface DistrictSceneOptions {
  world: AtlasLivingWorldDefinition;
  restoration: AtlasRestorationState;
  reducedMotion: boolean;
}

export interface DistrictSceneProjection {
  districtId: AtlasLivingWorldDefinition['districtId'];
  worldId: string;
  restoration: AtlasRestorationState;
  activeEntityIds: readonly string[];
  restorationEffects: readonly boolean[];
  proof: string;
  installation: string;
  ambientMotionEnabled: boolean;
}

export function createDistrictScene(options: DistrictSceneOptions): DistrictSceneProjection {
  const snapshot = projectLivingWorld(options.world, createAtlasState(options.world.mission), options.restoration);
  const activeEntityIds = snapshot.entities.filter((entity) => entity.active).map((entity) => entity.id);
  const restored = options.restoration === 'restored';
  return {
    districtId: options.world.districtId,
    worldId: options.world.id,
    restoration: options.restoration,
    activeEntityIds,
    restorationEffects: [restored, restored, restored],
    proof: options.world.chapter.proof,
    installation: options.world.chapter.installation,
    ambientMotionEnabled: !options.reducedMotion,
  };
}
