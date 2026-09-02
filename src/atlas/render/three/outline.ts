import { BackSide, Mesh, MeshBasicMaterial, type Object3D } from 'three';
import { ATLAS_WORLD_PALETTE } from '../../palette';
import type { AtlasQualityTier } from '../../../../shared/atlas/city/types';

const OUTLINE_FLAG = 'atlasOutline';

/*
 * Set on a mesh that must never be given an outline. The contact shadow uses
 * it: a blob is a flat disc lying on the ground, and an inverted hull around it
 * is a dark ring the size of the shadow. Marked explicitly rather than relying
 * on outlines being attached before shadows, because that ordering is invisible
 * at the call site and silently wrong once someone reorders it.
 */
export const NO_OUTLINE_FLAG = 'atlasNoOutline';

/*
 * Inverted hull, not post-processing.
 *
 * The alternative is an edge-detection pass through EffectComposer, which
 * looks better and costs a full-screen render target the delivery device does
 * not have to spare. This draws the same geometry back-facing and slightly
 * scaled up, so only the rim shows past the original silhouette. One extra
 * draw call per mesh, no render target, and it works on a weak GPU.
 *
 * Applied to characters only. Outlining every building in the district would
 * multiply the draw calls for the part of the frame nobody is looking at.
 */
export function outlinesEnabledForTier(tier: AtlasQualityTier): boolean {
  return tier !== 'low';
}

export function attachAtlasOutline(root: Object3D, thickness = 0.03): number {
  const targets: Mesh[] = [];
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    if (object.userData[OUTLINE_FLAG] || object.userData[NO_OUTLINE_FLAG]) return;
    targets.push(object);
  });
  let added = 0;
  for (const target of targets) {
    if (target.children.some((child) => child.userData[OUTLINE_FLAG])) continue;
    const hull = new Mesh(target.geometry, new MeshBasicMaterial({ color: ATLAS_WORLD_PALETTE.ink, side: BackSide }));
    hull.userData[OUTLINE_FLAG] = true;
    hull.scale.setScalar(1 + thickness);
    // The hull is inside-out geometry slightly larger than the character.
    // Casting from it would draw a second, oversized shadow beside the real one.
    hull.castShadow = false;
    hull.receiveShadow = false;
    target.add(hull);
    added += 1;
  }
  return added;
}
