import type { Object3D } from 'three';
import { findAtlasBone } from './character-bones';
import { advanceAtlasGait, atlasGaitArm, atlasGaitBody, atlasGaitFoot, solveAtlasLeg, type AtlasGaitState } from '../../../../shared/atlas/city/character-gait';

export interface AtlasLocomotionSample {
  readonly speedUnitsPerSecond: number;
  readonly worldScale: number;
}

export function createAtlasGaitRig(root: Object3D) {
  const hips = root.getObjectByName('hips');
  const spine = root.getObjectByName('spine');
  const chest = root.getObjectByName('chest');
  const neck = root.getObjectByName('neck');
  const head = root.getObjectByName('head');
  const legs = ['L', 'R'].map((side) => ({
    upper: findAtlasBone(root, `upper_leg.${side}`),
    lower: findAtlasBone(root, `lower_leg.${side}`),
    foot: findAtlasBone(root, `foot.${side}`),
    arm: findAtlasBone(root, `upper_arm.${side}`),
    elbow: findAtlasBone(root, `lower_arm.${side}`),
  }));
  if (!hips || legs.some((leg) => !leg.upper || !leg.lower || !leg.foot)) return null;
  const hipRest = hips.position.clone();
  const hipRotation = hips.rotation.clone();
  const spineRotation = spine?.rotation.clone();
  const chestRotation = chest?.rotation.clone();
  const neckRotation = neck?.rotation.clone();
  const headRotation = head?.rotation.clone();
  const armRotations = legs.map((leg) => ({ arm: leg.arm?.rotation.clone(), elbow: leg.elbow?.rotation.clone() }));
  const lengths = legs.map((leg) => ({ upper: leg.lower!.position.length(), lower: leg.foot!.position.length(), down: -leg.lower!.position.y - leg.foot!.position.y, forward: leg.foot!.position.z, ankleAngle: Math.atan2(leg.foot!.position.z, -leg.foot!.position.y) }));
  const legLength = lengths[0]!.upper + lengths[0]!.lower;
  let state: AtlasGaitState = { phase: 0, amount: 0, runBlend: 0 };
  return {
    snapshot: (): AtlasGaitState => ({ ...state }),
    restore(next: AtlasGaitState): void { state = { ...next }; },
    update(seconds: number, motion: AtlasLocomotionSample, running: boolean): void {
      state = advanceAtlasGait(state, seconds, motion.speedUnitsPerSecond, motion.worldScale, legLength, running);
      const amount = state.amount;
      if (amount < 0.0001) return;
      const body = atlasGaitBody(state.phase, legLength, state.runBlend, 1);
      hips.position.x = mix(hips.position.x, hipRest.x + body.sway, amount);
      hips.position.y = mix(hips.position.y, hipRest.y - body.drop + body.rise, amount);
      blendRotation(hips, hipRotation.x + body.lean, hipRotation.y + body.pelvisYaw, hipRotation.z + body.pelvisRoll, amount);
      if (spine && spineRotation) blendRotation(spine, spineRotation.x - body.lean * 0.22, spineRotation.y + body.chestYaw * 0.48, spineRotation.z - body.pelvisRoll * 0.32, amount);
      if (chest && chestRotation) blendRotation(chest, chestRotation.x - body.lean * 0.34, chestRotation.y + body.chestYaw, chestRotation.z - body.pelvisRoll * 0.52, amount);
      if (neck && neckRotation) blendRotation(neck, neckRotation.x - body.lean * 0.12, neckRotation.y - body.chestYaw * 0.32, neckRotation.z + body.pelvisRoll * 0.2, amount);
      if (head && headRotation) blendRotation(head, headRotation.x - body.lean * 0.08, headRotation.y - body.chestYaw * 0.46, headRotation.z + body.pelvisRoll * 0.34, amount);
      legs.forEach((leg, index) => {
        const foot = atlasGaitFoot(state.phase + index * 0.5, legLength, state.runBlend);
        const length = lengths[index]!;
        const targetDown = length.down - body.drop + body.rise - foot.lift;
        const pose = solveAtlasLeg(length.upper, length.lower, targetDown, length.forward + foot.forward);
        blendRotation(leg.upper!, pose.hip, 0, 0, amount);
        blendRotation(leg.lower!, pose.knee + length.ankleAngle, 0, 0, amount);
        blendRotation(leg.foot!, -pose.hip - pose.knee - length.ankleAngle + foot.pitch, 0, 0, amount);
        const armPose = atlasGaitArm(state.phase + index * 0.5, state.runBlend, 1);
        const rest = armRotations[index]!;
        if (leg.arm && rest.arm) {
          const outward = index === 0 ? armPose.shoulderRoll : -armPose.shoulderRoll;
          blendRotation(leg.arm, rest.arm.x + armPose.shoulderPitch, rest.arm.y, rest.arm.z + outward, amount);
        }
        if (leg.elbow && rest.elbow) blendRotation(leg.elbow, rest.elbow.x + armPose.elbowFlex, rest.elbow.y, rest.elbow.z, amount);
      });
    },
  };
}

function blendRotation(object: Object3D, x: number, y: number, z: number, amount: number): void {
  object.rotation.set(mix(object.rotation.x, x, amount), mix(object.rotation.y, y, amount), mix(object.rotation.z, z, amount));
}

function mix(from: number, to: number, amount: number): number {
  return from + (to - from) * Math.max(0, Math.min(1, amount));
}
