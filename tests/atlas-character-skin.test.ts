import { readFileSync } from 'node:fs';
import { SkinnedMesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { refineAtlasCharacterSkin } from '../src/atlas/render/three/character-skin';
import { createAtlasCharacterAnimator } from '../src/atlas/render/three/character-animation';
import { disposeAtlasSceneResources } from '../src/atlas/render/three/scene-instance';
import { findAtlasBone } from '../src/atlas/render/three/character-bones';

async function load(name = 'atlas-walker-player') {
  const bytes = readFileSync(new URL(`../public/atlas/3d/v1/characters/${name}.glb`, import.meta.url));
  return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
}

describe('native Walker deformation', () => {
  it('keeps articulated nearby NPCs inside the existing 3,300-triangle limit', async () => {
    const gltf = await load('atlas-walker-npc-lod1');
    refineAtlasCharacterSkin(gltf.scene, 'npc');
    let triangles = 0;
    gltf.scene.traverse((object) => { if (object instanceof SkinnedMesh) triangles += object.geometry.index!.count / 3; });
    expect(triangles).toBeLessThan(3301);
    disposeAtlasSceneResources(gltf.scene);
  });
  it('rebuilds connected joint rings with normalized blended weights inside the player budget', async () => {
    const gltf = await load();
    refineAtlasCharacterSkin(gltf.scene);
    let blended = 0, triangles = 0, refined = 0;
    gltf.scene.traverse((object) => {
      if (!(object instanceof SkinnedMesh)) return;
      triangles += object.geometry.index!.count / 3;
      if (!object.geometry.userData.atlasConnectedLimbs) return;
      refined++;
      const weight = object.geometry.getAttribute('skinWeight');
      const normal = object.geometry.getAttribute('normal');
      for (let i = 0; i < weight.count; i++) {
        expect(weight.getX(i) + weight.getY(i) + weight.getZ(i) + weight.getW(i)).toBeCloseTo(1, 5);
        if (weight.getY(i) > 0 && weight.getY(i) < 1) blended++;
        expect(Number.isFinite(normal.getX(i) + normal.getY(i) + normal.getZ(i))).toBe(true);
      }
    });
    expect(refined).toBe(2);
    expect(blended).toBeGreaterThan(40);
    expect(triangles).toBeLessThan(5201);
    disposeAtlasSceneResources(gltf.scene);
  });
  it('keeps actual rig ankles on their ground plane during stance and carries phase across LOD handoff', async () => {
    const gltf = await load();
    const animator = createAtlasCharacterAnimator(gltf.scene, gltf.animations);
    const foot = findAtlasBone(gltf.scene, 'foot.L')!;
    const ground = foot.getWorldPosition(new Vector3()).y;
    animator.restoreGait({ phase: 0.1, amount: 1, runBlend: 0 });
    animator.update('walk', 0, 1, 'neutral', { speedUnitsPerSecond: 1.15, worldScale: 0.72 });
    // Pelvis roll introduces a bounded sub-5 mm ankle variation while the foot
    // remains visually planted. Requiring a perfectly flat pelvis recreates the
    // rigid, weightless walk this gait replaces.
    expect(foot.getWorldPosition(new Vector3()).y).toBeCloseTo(ground, 2);
    const other = await load();
    const arriving = createAtlasCharacterAnimator(other.scene, other.animations);
    arriving.restoreGait(animator.gaitState());
    expect(arriving.gaitState()).toEqual(animator.gaitState());
    animator.stop();
    arriving.stop();
    disposeAtlasSceneResources(gltf.scene);
    disposeAtlasSceneResources(other.scene);
  });
});
