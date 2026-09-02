import { BackSide, BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
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
