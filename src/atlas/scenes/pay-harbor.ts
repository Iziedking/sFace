import { createAtlasState, type AtlasState } from '../../../shared/atlas/state';
import { PAY_HARBOR_WORLD } from '../../../shared/atlas/districts/pay-harbor';
import { projectLivingWorld, type AtlasRestorationState, type AtlasLivingWorldSnapshot } from '../../../shared/atlas/living-world';
import type { AtlasAudioCue } from '../audio/atlas-audio';

export interface PayHarborSceneOptions {
  restoration: AtlasRestorationState;
  reducedMotion: boolean;
  state?: AtlasState;
}

export interface PayHarborSceneProjection {
  snapshot: AtlasLivingWorldSnapshot;
  restoration: AtlasRestorationState;
  market: { stallsOpen: boolean };
  ferrySchedule: 'moored' | 'running';
  towerLit: boolean;
  residentSchedule: 'waiting' | 'checking' | 'market-open';
  routeAccess: 'closed' | 'verification' | 'open';
  audioLayers: readonly AtlasAudioCue[];
  interactionTargets: readonly string[];
  restorationEffects: { market: boolean; ferry: boolean; tower: boolean; paths: boolean };
  entityOrder: readonly { id: string; depthKey: number }[];
  ambientMotionEnabled: boolean;
}

export function createPayHarborScene(options: PayHarborSceneOptions): PayHarborSceneProjection {
  const state = options.state ?? createAtlasState(PAY_HARBOR_WORLD.mission);
  const snapshot = projectLivingWorld(PAY_HARBOR_WORLD, state, options.restoration);
  const restored = options.restoration === 'restored';
  const confirming = options.restoration === 'confirming';
  const activeEntities = snapshot.entities.filter((entity) => entity.active);
  const entityOrder = activeEntities
    .map((entity) => ({ id: entity.id, depthKey: entity.y + entity.depth }))
    .sort((left, right) => left.depthKey - right.depthKey || left.id.localeCompare(right.id));
  const interactionTargets = restored
    ? ['mara', 'restored-lantern-stall', 'harbor-ferry', 'harbor-tower']
    : confirming
      ? ['mara', 'confirmation-station']
      : ['mara', 'waiting-lantern-stall', 'harbor-tower'];
  const restorationEffects = { market: restored, ferry: restored, tower: restored, paths: restored };
  const audioLayers: readonly AtlasAudioCue[] = restored
    ? ['harbor-restored-ambience', 'beacon-confirmation']
    : confirming
      ? ['payment-pending']
      : ['harbor-waiting-ambience'];
  return {
    snapshot,
    restoration: options.restoration,
    market: { stallsOpen: restored },
    ferrySchedule: restored ? 'running' : 'moored',
    towerLit: restored,
    residentSchedule: restored ? 'market-open' : confirming ? 'checking' : 'waiting',
    routeAccess: restored ? 'open' : confirming ? 'verification' : 'closed',
    audioLayers,
    interactionTargets,
    restorationEffects,
    entityOrder,
    ambientMotionEnabled: !options.reducedMotion,
  };
}
