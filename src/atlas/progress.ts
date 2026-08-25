import type { AtlasDistrictId, AtlasRole } from '../../shared/atlas/types';
import {
  createAtlasPlayerProgress,
  migrateAtlasPlayerProgress,
} from '../../shared/atlas/roles';
import type { AtlasPlayerProgressV2 } from '../../shared/atlas/types';

const STORAGE_KEY = 'sface-atlas-progress-v2';
const LEGACY_STORAGE_KEY = 'sface-atlas-progress-v1';

export type AtlasLocalProgress = AtlasPlayerProgressV2;

interface AtlasStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface AtlasProgressStore {
  load(): AtlasLocalProgress;
  setRole(role: AtlasRole): AtlasLocalProgress;
  completeDistrict(districtId: AtlasDistrictId): AtlasLocalProgress;
  completeTrial(trialId: string): AtlasLocalProgress;
}

export function createAtlasProgressStore(storage: AtlasStorage): AtlasProgressStore {
  const read = (): AtlasLocalProgress => {
    try {
      const value = storage.getItem(STORAGE_KEY) ?? storage.getItem(LEGACY_STORAGE_KEY);
      if (!value) return emptyProgress();
      const progress = migrateAtlasPlayerProgress(JSON.parse(value));
      if (storage.getItem(STORAGE_KEY) === null) storage.setItem(STORAGE_KEY, JSON.stringify(progress));
      return {
        ...progress,
        completedAdventureIds: progress.completedAdventureIds.filter((item) => isDistrictId(item) || /^[a-z0-9-]{1,80}$/.test(item)),
      };
    } catch {
      return emptyProgress();
    }
  };
  const write = (progress: AtlasLocalProgress): AtlasLocalProgress => {
    storage.setItem(STORAGE_KEY, JSON.stringify(progress));
    return progress;
  };
  return {
    load: read,
    setRole(role) {
      const current = read();
      return write({ ...current, activeRole: role });
    },
    completeDistrict(districtId) {
      const current = read();
      return write({ ...current, completedAdventureIds: [...new Set([...current.completedAdventureIds, districtId])] });
    },
    completeTrial(trialId) {
      if (!/^[a-z0-9-]{1,80}$/.test(trialId)) throw new Error('Atlas trial id is invalid.');
      const current = read();
      return write({ ...current, completedTrialIds: [...new Set([...current.completedTrialIds, trialId])] });
    },
  };
}

function emptyProgress(): AtlasLocalProgress {
  return createAtlasPlayerProgress();
}

function isDistrictId(value: unknown): value is AtlasDistrictId {
  return typeof value === 'string' && ['genesis-garden', 'light-forest', 'pay-harbor', 'albatross-causeway', 'validator-peaks', 'builder-city'].includes(value);
}
