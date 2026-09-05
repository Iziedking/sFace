import { BackSide, BoxGeometry, Group, Mesh, MeshStandardMaterial, SkinnedMesh, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { attachAtlasOutline, outlinesEnabledForTier } from '../src/atlas/render/three/outline';
import { createBlobShadow } from '../src/atlas/render/three/shadows';

function characterLike(): Group {
  const root = new Group();
  root.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial()));
  root.add(new Mesh(new BoxGeometry(1, 2, 1), new MeshStandardMaterial()));
  return root;
}

describe('Atlas ink outlines', () => {
  it('runs on high and balanced but never on the low tier', () => {
    expect(outlinesEnabledForTier('high')).toBe(true);
    expect(outlinesEnabledForTier('balanced')).toBe(true);
    expect(outlinesEnabledForTier('low')).toBe(false);
  });

  it('adds one back-facing hull per mesh', () => {
    const root = characterLike();
    expect(attachAtlasOutline(root)).toBe(2);
    const hulls = root.children.flatMap((child) => child.children).filter((child): child is Mesh => child instanceof Mesh);
    expect(hulls).toHaveLength(2);
    for (const hull of hulls) {
      expect((hull.material as MeshStandardMaterial).side).toBe(BackSide);
      expect(hull.scale.x).toBeGreaterThan(1);
    }
  });

  it('shares the source geometry rather than cloning it', () => {
    // A cloned geometry per outline would double the memory for no gain; the
    // hull only needs the same vertices drawn back-facing and scaled out.
    const root = characterLike();
    attachAtlasOutline(root);
    const source = root.children[0] as Mesh;
    const hull = source.children[0] as Mesh;
    expect(hull.geometry).toBe(source.geometry);
  });

  it('never outlines an outline', () => {
    const root = characterLike();
    attachAtlasOutline(root);
    expect(attachAtlasOutline(root)).toBe(0);
  });

  it('never outlines a contact shadow', () => {
    // The blob is a flat disc on the ground. An inverted hull around it draws a
    // dark ring exactly the size of the shadow, which reads as a hole.
    const root = characterLike();
    root.add(createBlobShadow());
    expect(attachAtlasOutline(root)).toBe(2);
    const blob = root.children[2] as Mesh;
    expect(blob.children).toHaveLength(0);
  });

  it('never lets a hull take part in the shadow pass', () => {
    // The hull is inside-out geometry. Casting from it would produce a shadow
    // slightly larger than the character, offset from the real one.
    const root = characterLike();
    attachAtlasOutline(root);
    const hull = (root.children[0] as Mesh).children[0] as Mesh;
    expect(hull.castShadow).toBe(false);
    expect(hull.receiveShadow).toBe(false);
  });
});

describe('Atlas outlines do not ghost the character', () => {
  /*
   * The regression a playtester found as "the character is having a double
   * effect" while walking.
   *
   * Character parts are authored in character space, so a part's geometry sits
   * far from its object origin. Scaling the hull about that origin translated
   * it by a fraction of that distance and drew a second, offset body.
   */
  function partAuthoredInCharacterSpace(): Group {
    const root = new Group();
    // A head-sized box centred 1.9 m above the origin, as build_character.py emits.
    const geometry = new BoxGeometry(0.2, 0.2, 0.2);
    geometry.translate(0, 1.9, 0);
    root.add(new Mesh(geometry, new MeshStandardMaterial()));
    return root;
  }

  it('keeps the hull on top of the part it outlines', () => {
    const root = partAuthoredInCharacterSpace();
    attachAtlasOutline(root);
    const source = root.children[0] as Mesh;
    const hull = source.children[0] as Mesh;

    source.updateMatrixWorld(true);
    const sourceCentre = new Vector3(0, 1.9, 0);
    const hullCentre = sourceCentre.clone().applyMatrix4(hull.matrix);
    // A plain setScalar(1.03) moved this by 1.9 * 0.03 = 57 mm. The rim of a
    // 20 cm part should be a few millimetres, so anything near a centimetre is
    // the bug returning.
    expect(hullCentre.distanceTo(sourceCentre)).toBeLessThan(0.001);
  });

  it('still grows the hull enough to read as a rim', () => {
    const root = partAuthoredInCharacterSpace();
    attachAtlasOutline(root);
    const hull = (root.children[0] as Mesh).children[0] as Mesh;
    expect(hull.scale.x).toBeGreaterThan(1);
  });

  it('does not attach a rigid hull to an animated skinned mesh', () => {
    const root = new Group();
    const body = new SkinnedMesh(new BoxGeometry(1, 2, 1), new MeshStandardMaterial());
    root.add(body);

    expect(attachAtlasOutline(root)).toBe(0);
    expect(body.children).toHaveLength(0);
  });
});
