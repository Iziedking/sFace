import { describe, expect, it } from 'vitest';
import { Bone, Group } from 'three';
import { atlasCitizenAppearance, atlasRoleAppearance } from '../shared/atlas/city/character-appearance';
import { applyAtlasCitizenIdentity, createAtlasPlayerRoleAppearance } from '../src/atlas/render/three/character-appearance';

describe('Atlas character visual identity', () => {
  it('gives Explorer and Builder different readable equipment silhouettes', () => {
    const explorer = atlasRoleAppearance('explorer');
    const builder = atlasRoleAppearance('builder');

    expect(explorer.role).toBe('explorer');
    expect(builder.role).toBe('builder');
    expect(explorer.silhouette).not.toBe(builder.silhouette);
    expect(explorer.equipment).not.toEqual(builder.equipment);
    expect(explorer.accent).not.toBe(builder.accent);
  });

  it('keeps each citizen identity deterministic between district loads', () => {
    const first = atlasCitizenAppearance('merchant1', 'community-merchant');
    const second = atlasCitizenAppearance('merchant1', 'community-merchant');

    expect(second).toEqual(first);
  });

  it('spreads the nearby crowd across multiple face and hair profiles', () => {
    const profiles = Array.from({ length: 24 }, (_, index) =>
      atlasCitizenAppearance(`citizen-${index}`, index % 2 === 0 ? 'community-explorer' : 'community-repairer'),
    );

    expect(new Set(profiles.map((profile) => profile.face)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(profiles.map((profile) => profile.hair)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(profiles.map((profile) => profile.wardrobeIndex)).size).toBeGreaterThanOrEqual(4);
    expect(profiles.every((profile) => profile.bodyScale >= 0.94 && profile.bodyScale <= 1.06)).toBe(true);
  });

  it('switches player equipment as one persistent visual kit', () => {
    const root = characterRoot();
    const appearance = createAtlasPlayerRoleAppearance(root, 'explorer');

    expect(root.getObjectByName('atlas-role-explorer')?.visible).toBe(true);
    expect(root.getObjectByName('atlas-role-builder')?.visible).toBe(false);
    expect(root.getObjectByName('atlas-explorer-survey-tube')).toBeTruthy();
    expect(root.getObjectByName('atlas-builder-tool-pod-left')).toBeTruthy();

    appearance.setRole('builder');
    expect(root.getObjectByName('atlas-role-explorer')?.visible).toBe(false);
    expect(root.getObjectByName('atlas-role-builder')?.visible).toBe(true);

    appearance.dispose();
    expect(root.getObjectByName('atlas-role-appearance')).toBeUndefined();
  });

  it('attaches stable nearby hair and face shape to the animated head bone', () => {
    const root = characterRoot();
    const head = root.getObjectByName('head')!;
    const identity = applyAtlasCitizenIdentity(root, {
      wardrobeIndex: 0,
      bodyScale: 1,
      face: 'broad',
      hair: 'side-bun',
    }, '#2c2530');

    expect(head.scale.x).toBeGreaterThan(1);
    expect(head.getObjectByName('atlas-hair-side-bun')).toBeTruthy();
    expect(head.getObjectByName('atlas-citizen-identity')).toBeTruthy();

    identity.dispose();
    expect(head.scale.x).toBe(1);
    expect(head.getObjectByName('atlas-citizen-identity')).toBeUndefined();
  });
});

function characterRoot(): Group {
  const root = new Group();
  const hips = new Bone();
  hips.name = 'hips';
  const chest = new Bone();
  chest.name = 'chest';
  const head = new Bone();
  head.name = 'head';
  const leftEye = new Bone();
  leftEye.name = 'eye.L';
  leftEye.position.x = 0.061;
  const rightEye = new Bone();
  rightEye.name = 'eye.R';
  rightEye.position.x = -0.061;
  head.add(leftEye, rightEye);
  root.add(hips, chest, head);
  return root;
}
