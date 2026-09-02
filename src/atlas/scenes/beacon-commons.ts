export const BEACON_COMMONS_BUNDLE = 'beacon-commons';

export type BeaconCommonsSharedState = 'loading' | 'live' | 'stale' | 'unavailable';

export interface BeaconCommonsSceneOptions {
  sharedState: BeaconCommonsSharedState;
  verifiedContributorCount: number;
  reducedMotion: boolean;
}

export interface BeaconCommonsSceneProjection {
  districtId: 'beacon-core';
  bundle: typeof BEACON_COMMONS_BUNDLE;
  sharedState: BeaconCommonsSharedState;
  verifiedContributorCount: number;
  personalSpace: { available: true; copy: string };
  knowledgeBook: { available: true; copy: string };
  passport: { available: false; copy: string };
  expeditionBoard: { available: false; copy: string };
  transportGates: readonly { id: string; label: string; available: boolean }[];
  ambientMotionEnabled: boolean;
}

export function createBeaconCommonsScene(options: BeaconCommonsSceneOptions): BeaconCommonsSceneProjection {
  return {
    districtId: 'beacon-core',
    bundle: BEACON_COMMONS_BUNDLE,
    sharedState: options.sharedState,
    verifiedContributorCount: Math.max(0, Math.floor(options.verifiedContributorCount)),
    personalSpace: { available: true, copy: 'Your local Atlas progress stays on this device.' },
    knowledgeBook: { available: true, copy: 'Review the rules you have learned before your next expedition.' },
    passport: { available: false, copy: 'Passport verification is not connected in this build.' },
    expeditionBoard: { available: false, copy: 'Server-verified expeditions will appear here when the board is enabled.' },
    transportGates: [
      { id: 'pay-harbor', label: 'Pay Harbor', available: true },
      { id: 'living-restoration', label: 'Living Restoration', available: false },
      { id: 'beacon-core', label: 'Beacon Core', available: false },
    ],
    ambientMotionEnabled: !options.reducedMotion,
  };
}
