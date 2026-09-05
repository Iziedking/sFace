import type { Object3D } from 'three';
import { findAtlasBone } from './character-bones';
import { advanceAtlasGait, atlasGaitFoot, solveAtlasLeg, type AtlasGaitState } from '../../../../shared/atlas/city/character-gait';

export interface AtlasLocomotionSample {
  readonly speedUnitsPerSecond: number;
  readonly worldScale: number;
}

export function createAtlasGaitRig(root: Object3D) {
  const hips = root.getObjectByName('hips');
  const legs = ['L', 'R'].map((side) => ({
    upper: findAtlasBone(root, `upper_leg.${side}`),
    lower: findAtlasBone(root, `lower_leg.${side}`),
    foot: findAtlasBone(root, `foot.${side}`),
    arm: findAtlasBone(root, `upper_arm.${side}`),
    elbow: findAtlasBone(root, `lower_arm.${side}`),
  }));
  if (!hips || legs.some((leg) => !leg.upper || !leg.lower || !leg.foot)) return null;
  const hipRest = hips.position.clone();
  const lengths = legs.map((leg) => ({ upper: leg.lower!.position.length(), lower: leg.foot!.position.length(), down: -leg.lower!.position.y - leg.foot!.position.y, forward: leg.foot!.position.z, ankleAngle: Math.atan2(leg.foot!.position.z, -leg.foot!.position.y) }));
  const legLength = lengths[0]!.upper + lengths[0]!.lower;
  let state: AtlasGaitState = { phase: 0, amount: 0, runBlend: 0 };
  return {
    snapshot: (): AtlasGaitState => ({ ...state }),
    restore(next: AtlasGaitState): void { state = { ...next }; },
    update(seconds: number, motion: AtlasLocomotionSample, running: boolean): void {
      state = advanceAtlasGait(state, seconds, motion.speedUnitsPerSecond, motion.worldScale, legLength, running);
      const crouch = legLength * (0.1 + state.runBlend * 0.035) * state.amount;
      // Keep the pelvis level so stance feet share the authored flat ground.
      // The chest and head retain the clip's restrained counter-motion.
      hips.position.copy(hipRest);
      hips.position.y -= crouch;
      hips.rotation.set(0, 0, 0);
      legs.forEach((leg, index) => {
        const foot = atlasGaitFoot(state.phase + index * 0.5, legLength, state.runBlend);
        const length = lengths[index]!;
        const pose = solveAtlasLeg(length.upper, length.lower, length.down - crouch - foot.lift * state.amount, length.forward + foot.forward * state.amount);
        leg.upper!.rotation.set(pose.hip, 0, 0);
        leg.lower!.rotation.set(pose.knee + length.ankleAngle, 0, 0);
        leg.foot!.rotation.set(-pose.hip - pose.knee - length.ankleAngle, 0, 0);
        if (leg.arm) leg.arm.rotation.x = Math.sin((state.phase + index * 0.5) * Math.PI * 2) * (0.25 + state.runBlend * 0.3) * state.amount;
        if (leg.elbow) leg.elbow.rotation.x = -(0.15 + state.runBlend * 0.8) * state.amount;
      });
    },
  };
}
