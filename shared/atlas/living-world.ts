import type { AtlasSnapshot, AtlasState } from './state';
import { snapshotAtlasState } from './state';
import type { AtlasDistrictId } from './types';
import type { AtlasMissionDefinition, AtlasPoint } from './world';

export type AtlasRestorationState = 'waiting' | 'confirming' | 'restored';
export type AtlasWorldEntityKind = 'resident' | 'building' | 'transport' | 'light' | 'station' | 'prop';

export interface AtlasWorldEntity extends AtlasPoint {
  id: string;
  kind: AtlasWorldEntityKind;
  depth: number;
  activeWhen: readonly AtlasRestorationState[];
}

export interface AtlasLivingWorldDefinition {
  id: string;
  districtId: AtlasDistrictId;
  mission: AtlasMissionDefinition;
  entities: readonly AtlasWorldEntity[];
  chapter: AtlasLivingWorldChapter;
}

/**
 * The rungs of the cascade, smallest scale first.
 *
 * Every district teaches the same idea, that an assertion is not evidence, one
 * scale larger than the district before it. The union is closed on purpose:
 * adding a district means deciding which rung it occupies, and two districts
 * cannot share a rung. That constraint is what stopped seven districts from
 * drifting back into seven restatements of the payment lesson.
 */
export type AtlasCascadeScale =
  | 'payment'
  | 'lookup'
  | 'block'
  | 'consensus'
  | 'proof'
  | 'authority'
  | 'composition';

export interface AtlasLivingWorldChapter {
  humanNeed: string;
  explorerAction: string;
  builderRepair: string;
  proof: string;
  installation: string;
  teachBack: string;
  /** Which rung of the cascade this district occupies. */
  scale: AtlasCascadeScale;
  /** What the world appears to accept as proof at this scale. */
  claim: string;
  /** Why that is not proof. This is the line the refusal beat shows. */
  refutation: string;
  /** What actually settles it. */
  evidence: string;
}

export interface AtlasLivingWorldSnapshot {
  districtId: AtlasDistrictId;
  restoration: AtlasRestorationState;
  player: AtlasSnapshot['player'];
  simulation: AtlasSnapshot;
  entities: Array<AtlasWorldEntity & { active: boolean }>;
}

export function projectLivingWorld(world: AtlasLivingWorldDefinition, state: AtlasState, restoration: AtlasRestorationState): AtlasLivingWorldSnapshot {
  if (state.mission.id !== world.mission.id) throw new Error('Living-world mission does not match the simulation.');
  const simulation = snapshotAtlasState(state);
  return {
    districtId: world.districtId,
    restoration,
    player: simulation.player,
    simulation,
    entities: world.entities.map((entity) => ({
      ...structuredClone(entity),
      active: entity.activeWhen.includes(restoration),
    })),
  };
}
