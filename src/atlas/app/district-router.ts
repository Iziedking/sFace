import type { AtlasDistrictId } from '../../../shared/atlas/types';
import {
  AtlasAssetManifestStaleError,
  type AtlasAssetManager,
} from '../assets/asset-manager';

export type AtlasTravelState =
  | { phase: 'idle'; districtId: AtlasDistrictId }
  | { phase: 'preparing'; from: AtlasDistrictId; to: AtlasDistrictId }
  | { phase: 'travelling'; from: AtlasDistrictId; to: AtlasDistrictId }
  | { phase: 'arrived'; districtId: AtlasDistrictId }
  | {
      phase: 'failed';
      districtId: AtlasDistrictId;
      destination: AtlasDistrictId;
      reason: 'asset-unavailable' | 'manifest-stale';
    };

export interface AtlasDistrictRouterOptions {
  assets: AtlasAssetManager;
  initialDistrictId: AtlasDistrictId;
  hubDistrictId: string;
}

export function createAtlasDistrictRouter(options: AtlasDistrictRouterOptions) {
  let currentDistrictId = options.initialDistrictId;
  let travelState: AtlasTravelState = { phase: 'idle', districtId: currentDistrictId };
  let initialized = false;
  let bandwidth: 'low' | 'normal' = 'normal';
  let lastDestination: AtlasDistrictId | null = null;
  let travelInFlight = false;

  return {
    async initialize(loadOptions: { bandwidth?: 'low' | 'normal' } = {}): Promise<void> {
      if (initialized) return;
      bandwidth = loadOptions.bandwidth ?? bandwidth;
      await options.assets.acquire(currentDistrictId, { bandwidth });
      try {
        await options.assets.acquire(options.hubDistrictId, { bandwidth });
      } catch (error) {
        await options.assets.release(currentDistrictId);
        throw error;
      }
      initialized = true;
    },

    async travel(destination: AtlasDistrictId, loadOptions: { bandwidth?: 'low' | 'normal' } = {}): Promise<AtlasTravelState> {
      if (!initialized) throw new Error('NIM Atlas transport is not initialized.');
      if (travelInFlight) throw new Error('NIM Atlas transport is already moving.');
      if (destination === currentDistrictId) return { phase: 'arrived', districtId: currentDistrictId };
      bandwidth = loadOptions.bandwidth ?? bandwidth;
      lastDestination = destination;
      const from = currentDistrictId;
      travelState = { phase: 'preparing', from, to: destination };
      travelInFlight = true;
      try {
        await options.assets.acquire(destination, { bandwidth });
        travelState = { phase: 'travelling', from, to: destination };
        await options.assets.release(from);
        currentDistrictId = destination;
        travelState = { phase: 'arrived', districtId: destination };
        return travelState;
      } catch (error) {
        if (options.assets.references(destination) > 0) await options.assets.release(destination);
        travelState = {
          phase: 'failed',
          districtId: from,
          destination,
          reason: error instanceof AtlasAssetManifestStaleError ? 'manifest-stale' : 'asset-unavailable',
        };
        throw new Error('Atlas district travel failed.');
      } finally {
        travelInFlight = false;
      }
    },

    async retry(): Promise<AtlasTravelState> {
      if (!lastDestination || travelState.phase !== 'failed') throw new Error('NIM Atlas has no failed journey to retry.');
      return this.travel(lastDestination);
    },

    state(): AtlasTravelState { return structuredClone(travelState); },
    currentDistrict(): AtlasDistrictId { return currentDistrictId; },
    ownedBundles(): string[] { return options.assets.loadedBundles(); },
  };
}
