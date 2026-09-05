import type { AtlasCitizenRole } from './crowd';
import type { AtlasRole } from '../types';

export type AtlasCitizenHairProfile = 'close-crop' | 'side-bun' | 'high-coil' | 'soft-cap';
export type AtlasCitizenFaceProfile = 'narrow' | 'oval' | 'broad';

export interface AtlasCitizenAppearanceProfile {
  readonly wardrobeIndex: 0 | 1 | 2 | 3;
  readonly bodyScale: number;
  readonly face: AtlasCitizenFaceProfile;
  readonly hair: AtlasCitizenHairProfile;
}

export interface AtlasRoleAppearanceProfile {
  readonly role: AtlasRole;
  readonly silhouette: 'field-scout' | 'relay-maker';
  readonly equipment: readonly string[];
  readonly accent: 'explorer-gold' | 'builder-lilac';
}

const BODY_SCALES = [0.94, 1.02, 0.98, 1.06] as const;
const FACE_PROFILES = ['narrow', 'oval', 'broad'] as const;
const HAIR_PROFILES = ['close-crop', 'side-bun', 'high-coil', 'soft-cap'] as const;

export function atlasRoleAppearance(role: AtlasRole): AtlasRoleAppearanceProfile {
  return role === 'builder'
    ? { role, silhouette: 'relay-maker', equipment: ['wide-tool-belt', 'relay-pods'], accent: 'builder-lilac' }
    : { role, silhouette: 'field-scout', equipment: ['survey-tube', 'signal-compass'], accent: 'explorer-gold' };
}

export function atlasCitizenAppearance(id: string, role: AtlasCitizenRole): AtlasCitizenAppearanceProfile {
  const teamOffset = role === 'nimiq-team-guide' || role === 'nimiq-team-builder' ? 1 : 0;
  const wardrobeIndex = ((stableAppearanceHash(`${id}:wardrobe`) + teamOffset) % BODY_SCALES.length) as 0 | 1 | 2 | 3;
  return {
    wardrobeIndex,
    bodyScale: BODY_SCALES[wardrobeIndex],
    face: FACE_PROFILES[stableAppearanceHash(`${id}:face`) % FACE_PROFILES.length]!,
    hair: HAIR_PROFILES[stableAppearanceHash(`${id}:hair`) % HAIR_PROFILES.length]!,
  };
}

export function stableAppearanceHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return hash >>> 0;
}
