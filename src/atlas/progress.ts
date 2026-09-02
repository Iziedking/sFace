import type { AtlasDistrictId, AtlasRole } from '../../shared/atlas/types';
import {
  migrateAtlasPlayerProgress,
} from '../../shared/atlas/roles';
import type { AtlasPlayerProgressV3, AtlasPlayerProgressV2 } from '../../shared/atlas/types';
import { DEFAULT_ATLAS_AVATAR, validateAvatarConfig } from './avatar/avatar-config';

const STORAGE_KEY = 'sface-atlas-progress-v3';
const LEGACY_STORAGE_KEY = 'sface-atlas-progress-v2';
const LEGACY_V1_STORAGE_KEY = 'sface-atlas-progress-v1';

export type AtlasLocalProgress = AtlasPlayerProgressV3;

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
      const value = storage.getItem(STORAGE_KEY) ?? storage.getItem(LEGACY_STORAGE_KEY) ?? storage.getItem(LEGACY_V1_STORAGE_KEY);
      if (!value) return emptyProgress();
      const progress = migrateAtlasLocalProgress(JSON.parse(value));
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
  return migrateAtlasLocalProgress({ version: 2 });
}

export function migrateAtlasLocalProgress(value: unknown): AtlasLocalProgress {
  if (!isRecord(value) || typeof value.version !== 'number') throw new Error('Atlas progress version is missing.');
  const source = value.version === 3 ? { ...value, version: 2 } : value;
  const base: AtlasPlayerProgressV2 = migrateAtlasPlayerProgress(source);
  const avatar = value.version === 3 && 'avatar' in value ? validateAvatarConfig(value.avatar) : validateAvatarConfig(DEFAULT_ATLAS_AVATAR);
  return { ...base, version: 3, avatar };
}

function isDistrictId(value: unknown): value is AtlasDistrictId {
  return typeof value === 'string' && ['genesis-garden', 'light-forest', 'pay-harbor', 'albatross-causeway', 'validator-peaks', 'builder-city'].includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
