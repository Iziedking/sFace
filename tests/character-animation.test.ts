import { AnimationClip, Group, Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import {
  atlasCitizenAnimationState,
  atlasCitizenDetailLevel,
  createAtlasCharacterAnimator,
  type AtlasCharacterAnimationState,
} from '../src/atlas/render/three/character-animation';

function clips(): AnimationClip[] {
  return [
    new AnimationClip('Atlas_Idle', 2.4, []),
    new AnimationClip('Atlas_Walk', 1, []),
    new AnimationClip('Atlas_Run', 0.72, []),
  ];
}

describe('Atlas character animation controller', () => {
  it('starts idle and changes locomotion state without replacing its mixer', () => {
    const animator = createAtlasCharacterAnimator(new Group(), clips());
    expect(animator.state()).toBe('idle');
    const mixer = animator.mixer;
    for (const state of ['walk', 'run', 'idle'] satisfies AtlasCharacterAnimationState[]) {
      animator.update(state, 1 / 30);
      expect(animator.state()).toBe(state);
      expect(animator.mixer).toBe(mixer);
    }
  });

  it('preserves stride phase when blending between walk and run', () => {
    const animationClips = clips();
    const animator = createAtlasCharacterAnimator(new Group(), animationClips);
    animator.update('walk', 0);
    animator.update('walk', 0.25);
    const walk = animator.mixer.clipAction(animationClips[1]!);
    animator.update('run', 0);
    const run = animator.mixer.clipAction(animationClips[2]!);
    expect(run.time / animationClips[2]!.duration).toBeCloseTo(walk.time / animationClips[1]!.duration, 4);
  });

  it('adds deterministic blink and talking motion when facial bones are present', () => {
    const root = new Group();
    const leftEye = namedBone('eye.L');
    const rightEye = namedBone('eye.R');
    const mouth = namedBone('mouth');
    root.add(leftEye, rightEye, mouth);
    const animator = createAtlasCharacterAnimator(root, clips(), { facialPhase: 0 });

    let smallestEyeOpening = 1;
    for (let frame = 0; frame < 150; frame += 1) {
      animator.update('idle', 1 / 30, 1, 'neutral');
      smallestEyeOpening = Math.min(smallestEyeOpening, leftEye.scale.y, rightEye.scale.y);
    }
    expect(smallestEyeOpening).toBeLessThan(0.3);

    let largestMouthOpening = 0;
    for (let frame = 0; frame < 18; frame += 1) {
      animator.update('idle', 1 / 30, 1, 'talking');
      largestMouthOpening = Math.max(largestMouthOpening, mouth.scale.y);
    }
    expect(largestMouthOpening).toBeGreaterThan(0.65);
  });

  it('rejects incomplete character animation sets', () => {
    expect(() => createAtlasCharacterAnimator(new Group(), clips().slice(0, 2))).toThrow(/Atlas_Run/);
  });

  it('keeps ordinary moving citizens walking while stationary citizens idle', () => {
    expect(atlasCitizenAnimationState(false, 'walk')).toBe('idle');
    expect(atlasCitizenAnimationState(true, 'walk')).toBe('walk');
    expect(atlasCitizenAnimationState(true, 'run')).toBe('run');
  });

  it('keeps nearby citizens facial on balanced and high quality profiles', () => {
    expect(atlasCitizenDetailLevel('balanced', false, 4)).toBe('near');
    expect(atlasCitizenDetailLevel('balanced', false, 18)).toBe('distant');
    expect(atlasCitizenDetailLevel('high', false, 18)).toBe('near');
    expect(atlasCitizenDetailLevel('low', true, 2)).toBe('distant');
  });
});

function namedBone(name: string): Object3D {
  const bone = new Object3D();
  bone.name = name;
  return bone;
}
