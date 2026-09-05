import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import type { AtlasCitizenAppearanceProfile } from '../../../../shared/atlas/city/character-appearance';
import type { AtlasRole } from '../../../../shared/atlas/types';
import { ATLAS_WORLD_PALETTE } from '../../palette';

export interface AtlasPlayerRoleAppearance {
  setRole(role: AtlasRole): void;
  dispose(): void;
}

export interface AtlasCitizenIdentity {
  dispose(): void;
}

export function createAtlasPlayerRoleAppearance(root: Object3D, initialRole: AtlasRole): AtlasPlayerRoleAppearance {
  const container = new Group();
  container.name = 'atlas-role-appearance';
  root.add(container);

  const explorer = createExplorerKit();
  const builder = createBuilderKit();
  (root.getObjectByName('chest') ?? container).add(explorer);
  (root.getObjectByName('hips') ?? container).add(builder);

  const setRole = (role: AtlasRole): void => {
    explorer.visible = role === 'explorer';
    builder.visible = role === 'builder';
  };
  setRole(initialRole);

  return {
    setRole,
    dispose: () => {
      disposeVisualGroup(explorer);
      disposeVisualGroup(builder);
      explorer.removeFromParent();
      builder.removeFromParent();
      container.removeFromParent();
    },
  };
}

export function applyAtlasCitizenIdentity(root: Object3D, profile: AtlasCitizenAppearanceProfile, hairColor: string): AtlasCitizenIdentity {
  const head = root.getObjectByName('head');
  if (!head) return { dispose: () => undefined };

  const originalHeadScale = head.scale.clone();
  const eyeOffsets = ['eye.L', 'eye.R'].map((name) => {
    const eye = root.getObjectByName(name);
    return eye ? { eye, x: eye.position.x } : null;
  }).filter((entry): entry is { eye: Object3D; x: number } => entry !== null);
  const shape = faceScale(profile.face);
  head.scale.set(originalHeadScale.x * shape.x, originalHeadScale.y * shape.y, originalHeadScale.z * shape.z);
  for (const { eye, x } of eyeOffsets) eye.position.x = x * shape.eyeSpacing;

  const identity = new Group();
  identity.name = 'atlas-citizen-identity';
  head.add(identity);
  const hair = createHairProfile(profile.hair, hairColor);
  if (hair) identity.add(hair);

  return {
    dispose: () => {
      head.scale.copy(originalHeadScale);
      for (const { eye, x } of eyeOffsets) eye.position.x = x;
      disposeVisualGroup(identity);
      identity.removeFromParent();
    },
  };
}

function createExplorerKit(): Group {
  const group = new Group();
  group.name = 'atlas-role-explorer';
  const fieldMaterial = new MeshStandardMaterial({ color: ATLAS_WORLD_PALETTE.leather, roughness: 0.82 });
  const signalMaterial = new MeshStandardMaterial({ color: ATLAS_WORLD_PALETTE.explorerPath, roughness: 0.64 });

  const tube = new Mesh(new CylinderGeometry(0.05, 0.06, 0.5, 8), fieldMaterial);
  tube.name = 'atlas-explorer-survey-tube';
  tube.position.set(0.25, 0.08, -0.18);
  tube.rotation.z = -0.12;

  const compass = new Mesh(new CylinderGeometry(0.072, 0.072, 0.035, 10), signalMaterial);
  compass.name = 'atlas-explorer-signal-compass';
  compass.position.set(0.25, -0.18, 0.175);
  compass.rotation.x = Math.PI / 2;

  const signalRing = new Mesh(new TorusGeometry(0.065, 0.011, 5, 12), signalMaterial);
  signalRing.name = 'atlas-explorer-signal-ring';
  signalRing.position.set(0.25, 0.31, -0.18);
  signalRing.rotation.x = Math.PI / 2;
  group.add(tube, compass, signalRing);
  return group;
}

function createBuilderKit(): Group {
  const group = new Group();
  group.name = 'atlas-role-builder';
  const beltMaterial = new MeshStandardMaterial({ color: ATLAS_WORLD_PALETTE.leather, roughness: 0.86 });
  const toolMaterial = new MeshStandardMaterial({ color: ATLAS_WORLD_PALETTE.workwear, roughness: 0.78 });
  const relayMaterial = new MeshStandardMaterial({ color: ATLAS_WORLD_PALETTE.builderPath, roughness: 0.62 });

  const belt = new Mesh(new BoxGeometry(0.65, 0.075, 0.15), beltMaterial);
  belt.name = 'atlas-builder-tool-belt';
  belt.position.set(0, 0.21, -0.015);

  const leftPod = new Mesh(new BoxGeometry(0.15, 0.2, 0.17), toolMaterial);
  leftPod.name = 'atlas-builder-tool-pod-left';
  leftPod.position.set(0.3, 0.13, -0.015);
  leftPod.rotation.z = -0.06;

  const rightPod = new Mesh(new BoxGeometry(0.15, 0.2, 0.17), toolMaterial);
  rightPod.name = 'atlas-builder-tool-pod-right';
  rightPod.position.set(-0.3, 0.13, -0.015);
  rightPod.rotation.z = 0.06;

  const relayCoil = new Mesh(new TorusGeometry(0.055, 0.012, 5, 10), relayMaterial);
  relayCoil.name = 'atlas-builder-relay-coil';
  relayCoil.position.set(-0.3, 0.13, 0.078);
  group.add(belt, leftPod, rightPod, relayCoil);
  return group;
}

function createHairProfile(profile: AtlasCitizenAppearanceProfile['hair'], color: string): Mesh | null {
  const material = new MeshStandardMaterial({ color, roughness: 0.9 });
  if (profile === 'close-crop') {
    material.dispose();
    return null;
  }
  if (profile === 'side-bun') {
    const bun = new Mesh(new SphereGeometry(0.105, 8, 5), material);
    bun.name = 'atlas-hair-side-bun';
    bun.position.set(0.19, 0.11, -0.07);
    return bun;
  }
  if (profile === 'high-coil') {
    const coil = new Mesh(new SphereGeometry(0.115, 8, 5), material);
    coil.name = 'atlas-hair-high-coil';
    coil.position.set(0, 0.25, -0.025);
    coil.scale.set(0.92, 1.22, 0.92);
    return coil;
  }
  const cap = new Mesh(new SphereGeometry(0.145, 8, 5), material);
  cap.name = 'atlas-hair-soft-cap';
  cap.position.set(0, 0.16, -0.025);
  cap.scale.set(1.28, 0.52, 1.08);
  return cap;
}

function faceScale(profile: AtlasCitizenAppearanceProfile['face']): { x: number; y: number; z: number; eyeSpacing: number } {
  if (profile === 'narrow') return { x: 0.94, y: 1.025, z: 0.98, eyeSpacing: 0.96 };
  if (profile === 'broad') return { x: 1.07, y: 0.985, z: 1.025, eyeSpacing: 1.05 };
  return { x: 1, y: 1, z: 1, eyeSpacing: 1 };
}

function disposeVisualGroup(root: Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of new Set(materials)) material.dispose();
  });
}
