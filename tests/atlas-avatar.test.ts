import { describe, expect, it } from 'vitest';

import { DEFAULT_ATLAS_AVATAR, validateAvatarConfig } from '../src/atlas/avatar/avatar-config';
import { selectAvatarAnimation } from '../src/atlas/avatar/avatar-controller';
import { migrateAtlasLocalProgress } from '../src/atlas/progress';

describe('NIM Atlas modular avatar', () => {
  it('validates cosmetic choices and keeps the collision footprint implicit', () => {
    expect(validateAvatarConfig({
      face: 'face-01', body: 'body-01', skin: 'skin-06', hair: 'hair-04',
      workwear: 'harbor-01', accessories: ['glasses-01'], name: 'Kai', pronouns: 'they/them',
    })).toMatchObject({ face: 'face-01', body: 'body-01' });
  });

  it('rejects unknown assets, duplicate accessories, unsafe text, and hitbox overrides', () => {
    const valid = { ...DEFAULT_ATLAS_AVATAR, accessories: ['glasses-01'] };
    expect(() => validateAvatarConfig({ ...valid, hair: 'hair-unknown' })).toThrow(/asset/i);
    expect(() => validateAvatarConfig({ ...valid, accessories: ['glasses-01', 'glasses-01'] })).toThrow(/duplicate/i);
    expect(() => validateAvatarConfig({ ...valid, name: 'Kai\u0000' })).toThrow(/text/i);
    expect(() => validateAvatarConfig({ ...valid, name: 'K'.repeat(81) })).toThrow(/length/i);
    expect(() => validateAvatarConfig({ ...valid, collisionRadius: 999 })).toThrow(/collision/i);
  });

  it('selects a repeatable animation from integer simulation state', () => {
    const snapshot = { tick: 21, player: { facing: 'right' as const } };
    const context = { moving: true, action: 'scanner' as const, reducedMotion: false };
    expect(selectAvatarAnimation(snapshot, context)).toEqual(selectAvatarAnimation(snapshot, context));
    expect(selectAvatarAnimation(snapshot, context)).toMatchObject({ family: 'scanner', direction: 'right', frameIndex: 4 });
    expect(selectAvatarAnimation(snapshot, { ...context, reducedMotion: true })).toMatchObject({ frameIndex: 0, pose: 'reduced-motion' });
  });

  it('migrates older local progress to a neutral avatar without losing progress', () => {
    const migrated = migrateAtlasLocalProgress({ version: 2, activeRole: 'builder', completedAdventureIds: ['pay-harbor'], completedTrialIds: ['trial-1'], knowledgeFragmentIds: ['confirm'], mastery: 12 });
    expect(migrated).toMatchObject({ version: 3, activeRole: 'builder', completedAdventureIds: ['pay-harbor'], completedTrialIds: ['trial-1'], knowledgeFragmentIds: ['confirm'], mastery: 12, avatar: DEFAULT_ATLAS_AVATAR });
    expect(() => migrateAtlasLocalProgress({ version: 99 })).toThrow(/version/i);
  });
});
