import { BackSide, Mesh, MeshBasicMaterial, SkinnedMesh, Vector3, type Object3D } from 'three';
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
    /*
     * A plain Mesh hull cannot consume skin weights. It overlaps its SkinnedMesh
     * parent while idle, then stays rigid as the skeleton moves and reads as a
     * second body. Keep the inexpensive hull on rigid hair, gear and props; the
     * animated body gets its silhouette from the toon material and lighting.
     */
    if (object instanceof SkinnedMesh) return;
    if (object.userData[OUTLINE_FLAG] || object.userData[NO_OUTLINE_FLAG]) return;
    targets.push(object);
  });
  let added = 0;
  for (const target of targets) {
    if (target.children.some((child) => child.userData[OUTLINE_FLAG])) continue;
    const hull = new Mesh(target.geometry, new MeshBasicMaterial({ color: ATLAS_WORLD_PALETTE.ink, side: BackSide }));
    hull.userData[OUTLINE_FLAG] = true;
    /*
     * Scale about the geometry's own centre, not the object's origin.
     *
     * build_character.py authors every part in character space — the mouth sits
     * at y = 1.833, not at its own origin — so a plain scale.setScalar pushes
     * each part outward in proportion to its distance from the character's
     * feet. A head at y = 1.9 moved about six centimetres, and playtesters
     * reported the character "having a double effect" while walking: they were
     * seeing the offset hull as a second body.
     *
     * Offsetting by centre * (1 - scale) pins the hull to the same centre, so
     * the only growth is the part's own size times the thickness. A 20 cm head
     * gains six millimetres of rim, which is what an outline should be.
     */
    target.geometry.computeBoundingBox();
    const centre = new Vector3();
    target.geometry.boundingBox?.getCenter(centre);
    const scale = 1 + thickness;
    hull.scale.setScalar(scale);
    hull.position.copy(centre).multiplyScalar(1 - scale);
    // The hull is inside-out geometry slightly larger than the character.
    // Casting from it would draw a second, oversized shadow beside the real one.
    hull.castShadow = false;
    hull.receiveShadow = false;
    target.add(hull);
    added += 1;
  }
  return added;
}
