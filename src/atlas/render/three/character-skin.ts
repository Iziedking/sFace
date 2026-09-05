import { BufferGeometry, Float32BufferAttribute, Matrix4, SkinnedMesh, Uint16BufferAttribute, Vector3, type Object3D } from 'three';
import { matchesAtlasBone } from './character-bones';

/** Three 0.185.1: SkinnedMesh and BufferGeometry source checked 2026-09-05.
 * Refine the cache-owned native model before SkeletonUtils clones its geometry.
 * Environment meshes and other rigs must never pass through this adapter.
 */
export function refineAtlasCharacterSkin(root: Object3D, detail: 'player' | 'npc' = 'player'): void {
  const replaced = new Set<BufferGeometry>();
  root.traverse((object) => {
    if (!(object instanceof SkinnedMesh) || Array.isArray(object.material)) return;
    const garment = object.material.name;
    if (garment !== 'orange' && garment !== 'workwear') return;
    const original = object.geometry;
    const position = original.getAttribute('position');
    const skin = original.getAttribute('skinIndex');
    const weights = original.getAttribute('skinWeight');
    if (!position || !skin || !weights || !original.index) return;
    const bones = object.skeleton.bones;
    const prefix = garment === 'orange' ? 'arm' : 'leg';
    const limbs = ['L', 'R'].map((side) => {
      const upper = bones.findIndex((bone) => matchesAtlasBone(bone.name, `upper_${prefix}.${side}`));
      const lower = bones.findIndex((bone) => matchesAtlasBone(bone.name, `lower_${prefix}.${side}`));
      const end = bones.findIndex((bone) => matchesAtlasBone(bone.name, `${prefix === 'arm' ? 'hand' : 'foot'}.${side}`));
      return { upper, lower, end };
    }).filter((limb) => limb.upper >= 0 && limb.lower >= 0 && limb.end >= 0);
    const present = limbs.filter((limb) => {
      for (let i = 0; i < skin.count; i++) if (skin.getX(i) === limb.upper) return true;
      return false;
    });
    if (!present.length) return;
    const removed = new Set(present.flatMap((limb) => [limb.upper, limb.lower]));
    const positions: number[] = [], indices: number[] = [], joints: number[] = [], influences: number[] = [];
    const remap = new Map<number, number>();
    const copyVertex = (index: number): number => {
      const previous = remap.get(index);
      if (previous !== undefined) return previous;
      const next = positions.length / 3;
      positions.push(position.getX(index), position.getY(index), position.getZ(index));
      joints.push(skin.getX(index), skin.getY(index), skin.getZ(index), skin.getW(index));
      influences.push(weights.getX(index), weights.getY(index), weights.getZ(index), weights.getW(index));
      remap.set(index, next);
      return next;
    };
    for (let i = 0; i < original.index.count; i += 3) {
      const triangle = [original.index.getX(i), original.index.getX(i + 1), original.index.getX(i + 2)];
      if (triangle.some((vertex) => removed.has(skin.getX(vertex)))) continue;
      indices.push(...triangle.map(copyVertex));
    }
    const bindPoint = (index: number): Vector3 => new Vector3().setFromMatrixPosition(new Matrix4().copy(object.skeleton.boneInverses[index]!).invert());
    for (const limb of present) {
      const start = bindPoint(limb.upper), middle = bindPoint(limb.lower), end = bindPoint(limb.end);
      const length = start.distanceTo(middle) + middle.distanceTo(end);
      const jointFraction = start.distanceTo(middle) / length;
      const parent = bones.indexOf(bones[limb.upper]!.parent as typeof bones[number]);
      const sides = detail === 'npc' ? 8 : 10;
      const rings = detail === 'npc' ? 8 : 12;
      const base = positions.length / 3;
      const axis = end.clone().sub(start).normalize();
      const right = new Vector3(1, 0, 0).addScaledVector(axis, -axis.x).normalize();
      const forward = axis.clone().cross(right).normalize();
      for (let ring = 0; ring <= rings; ring++) {
        const t = ring / rings;
        const center = t <= jointFraction ? start.clone().lerp(middle, t / jointFraction) : middle.clone().lerp(end, (t - jointFraction) / (1 - jointFraction));
        const radius = length * (prefix === 'arm' ? 0.145 - 0.055 * t : 0.133 - 0.045 * t);
        const seam = 1 - smoothstep(0, 0.2, t);
        // Bury the first ring inside the jacket/hips. Ending a sleeve exactly
        // at its pivot leaves a visible cut edge when the shoulder rotates.
        center.addScaledVector(axis, -radius * 0.8 * seam);
        center.x -= Math.sign(start.x) * radius * 0.4 * seam;
        const lowerWeight = smoothstep(jointFraction - 0.15, jointFraction + 0.15, t);
        const parentWeight = parent >= 0 ? (1 - smoothstep(0, 0.18, t)) * 0.65 : 0;
        for (let side = 0; side < sides; side++) {
          const angle = side / sides * Math.PI * 2;
          const point = center.clone().addScaledVector(right, Math.cos(angle) * radius).addScaledVector(forward, Math.sin(angle) * radius * 0.9);
          positions.push(point.x, point.y, point.z);
          joints.push(limb.upper, limb.lower, Math.max(0, parent), 0);
          influences.push((1 - lowerWeight) * (1 - parentWeight), lowerWeight, parentWeight * (1 - lowerWeight), 0);
          if (ring < rings) {
            const a = base + ring * sides + side, b = base + ring * sides + (side + 1) % sides;
            indices.push(a, b, a + sides, b, b + sides, a + sides);
          }
        }
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('skinIndex', new Uint16BufferAttribute(joints, 4));
    geometry.setAttribute('skinWeight', new Float32BufferAttribute(influences, 4));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.userData.atlasConnectedLimbs = true;
    object.geometry = geometry;
    replaced.add(original);
  });
  // A loader may share a geometry between primitives. Only release it once and
  // only when no remaining object still uses it.
  root.traverse((object) => { if (object instanceof SkinnedMesh) replaced.delete(object.geometry); });
  replaced.forEach((geometry) => geometry.dispose());
}

function smoothstep(start: number, end: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
}
