import { AnimationMixer } from 'three';
import type { AnimationAction, AnimationClip, Object3D } from 'three';
import type { AtlasQualityTier } from '../../../../shared/atlas/city/types';
import type { AtlasCitizenActivity } from '../../../../shared/atlas/city/crowd';

export type AtlasCharacterAnimationState = 'idle' | 'walk' | 'run';
export type AtlasFacialCue = 'neutral' | 'focused' | 'talking' | 'pleased';

export interface AtlasCharacterAnimatorOptions {
  readonly facialPhase?: number;
}

export interface AtlasCharacterAnimator {
  readonly mixer: AnimationMixer;
  state(): AtlasCharacterAnimationState;
  update(state: AtlasCharacterAnimationState, deltaSeconds: number, speedScale?: number, facialCue?: AtlasFacialCue): void;
  stop(): void;
}

const CLIP_NAMES: Readonly<Record<AtlasCharacterAnimationState, string>> = {
  idle: 'Atlas_Idle',
  walk: 'Atlas_Walk',
  run: 'Atlas_Run',
};

const LOCOMOTION_CROSS_FADE_SECONDS = 0.22;
const IDLE_CROSS_FADE_SECONDS = 0.28;

export function createAtlasCharacterAnimator(
  root: Object3D,
  clips: readonly AnimationClip[],
  options: AtlasCharacterAnimatorOptions = {},
): AtlasCharacterAnimator {
  const mixer = new AnimationMixer(root);
  const actions = Object.fromEntries(
    (Object.entries(CLIP_NAMES) as Array<[AtlasCharacterAnimationState, string]>).map(([state, name]) => {
      const clip = clips.find((candidate) => candidate.name === name);
      if (!clip) throw new Error(`Atlas character animation ${name} is missing.`);
      return [state, mixer.clipAction(clip)];
    }),
  ) as Record<AtlasCharacterAnimationState, AnimationAction>;
  const face = createFacialRig(root, options.facialPhase ?? 0);

  let current: AtlasCharacterAnimationState = 'idle';
  actions.idle.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();

  return {
    mixer,
    state: () => current,
    update(nextState, deltaSeconds, speedScale = 1, facialCue = 'neutral') {
      const safeDelta = Number.isFinite(deltaSeconds) ? Math.min(0.25, Math.max(0, deltaSeconds)) : 0;
      const safeSpeed = Number.isFinite(speedScale) ? Math.min(1.75, Math.max(0.5, speedScale)) : 1;
      const next = actions[nextState];
      next.setEffectiveTimeScale(safeSpeed);
      if (nextState !== current) {
        const previous = actions[current];
        const previousClip = previous.getClip();
        const nextClip = next.getClip();
        const previousPhase = previousClip.duration > 0 ? positiveModulo(previous.time, previousClip.duration) / previousClip.duration : 0;
        next.reset().setEffectiveTimeScale(safeSpeed).setEffectiveWeight(1).play();
        if (current !== 'idle' && nextState !== 'idle' && nextClip.duration > 0) next.time = previousPhase * nextClip.duration;
        const fadeSeconds = current === 'idle' || nextState === 'idle' ? IDLE_CROSS_FADE_SECONDS : LOCOMOTION_CROSS_FADE_SECONDS;
        previous.crossFadeTo(next, fadeSeconds, false);
        current = nextState;
      }
      mixer.update(safeDelta);
      face?.update(safeDelta, facialCue);
    },
    stop() {
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
    },
  };
}

export function atlasCitizenAnimationState(
  active: boolean,
  requestedPace: Exclude<AtlasCharacterAnimationState, 'idle'>,
): AtlasCharacterAnimationState {
  if (!active) return 'idle';
  return requestedPace;
}

export function atlasCitizenFacialCue(activity: AtlasCitizenActivity): AtlasFacialCue {
  if (activity === 'talking' || activity === 'trading') return 'talking';
  if (activity === 'celebrating') return 'pleased';
  if (activity === 'repairing' || activity === 'planning' || activity === 'carrying' || activity === 'jogging') return 'focused';
  return 'neutral';
}

export function atlasCitizenDetailLevel(quality: AtlasQualityTier, active: boolean, distanceFromPlayer: number): 'near' | 'distant' {
  if (quality === 'low') return 'distant';
  if (active) return 'near';
  const nearDistance = quality === 'high' ? 20 : 12;
  return distanceFromPlayer <= nearDistance ? 'near' : 'distant';
}

interface AtlasFacialRig {
  update(deltaSeconds: number, cue: AtlasFacialCue): void;
}

function createFacialRig(root: Object3D, requestedPhase: number): AtlasFacialRig | null {
  const leftEye = root.getObjectByName('eye.L');
  const rightEye = root.getObjectByName('eye.R');
  const leftEyelid = root.getObjectByName('eyelid.L');
  const rightEyelid = root.getObjectByName('eyelid.R');
  const mouth = root.getObjectByName('mouth');
  if (!leftEye && !rightEye && !mouth) return null;

  const phase = positiveModulo(Number.isFinite(requestedPhase) ? requestedPhase : 0, 1);
  const eyeBase = [leftEye, rightEye].map((eye) => eye ? { eye, scaleY: eye.scale.y, rotationY: eye.rotation.y } : null);
  const eyelidBase = [leftEyelid, rightEyelid].map((eyelid) => eyelid ? { eyelid, y: eyelid.position.y } : null);
  const mouthBase = mouth ? { scaleX: mouth.scale.x, scaleY: mouth.scale.y, rotationZ: mouth.rotation.z } : null;
  let elapsedSeconds = phase * 2.7;

  return {
    update(deltaSeconds, cue) {
      elapsedSeconds += deltaSeconds;
      const blink = blinkClosure(elapsedSeconds, phase);
      const focus = cue === 'focused' ? 0.9 : 1;
      const glance = Math.sin(elapsedSeconds * 0.73 + phase * Math.PI * 2) * 0.075;
      for (const state of eyeBase) {
        if (!state) continue;
        state.eye.scale.y = state.scaleY * Math.max(0.08, (1 - blink * 0.92) * focus);
        state.eye.rotation.y = state.rotationY + glance;
      }
      for (const state of eyelidBase) {
        if (state) state.eyelid.position.y = state.y - blink * 0.014;
      }
      if (!mouth || !mouthBase) return;
      const speech = 0.5 + Math.sin(elapsedSeconds * 10.2 + phase * 5.3) * 0.5;
      const opening = cue === 'talking' ? 0.36 + speech * 0.58 : cue === 'pleased' ? 0.26 : 0.16;
      mouth.scale.x = mouthBase.scaleX * (cue === 'pleased' ? 1.18 : cue === 'talking' ? 0.96 + speech * 0.08 : 1);
      mouth.scale.y = mouthBase.scaleY * opening;
      mouth.rotation.z = mouthBase.rotationZ + (cue === 'pleased' ? -0.045 : Math.sin(elapsedSeconds * 1.2 + phase) * 0.012);
    },
  };
}

function blinkClosure(elapsedSeconds: number, phase: number): number {
  const period = 3.35 + phase * 1.25;
  const blinkDuration = 0.2;
  const cycle = positiveModulo(elapsedSeconds, period);
  const blinkStart = period - blinkDuration;
  if (cycle < blinkStart) return 0;
  return Math.sin(((cycle - blinkStart) / blinkDuration) * Math.PI);
}

function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}
