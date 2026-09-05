import { describe, expect, it } from 'vitest';
import { Group, Mesh } from 'three';
import { createHarborSupplies } from '../src/atlas/render/three/harbor-supplies';

describe('harbor supply props', () => {
  it('projects cargo and saved supplies, then releases owned resources once', () => {
    const scene = new Group();
    const player = new Group();
    const props = createHarborSupplies(scene, player, [0, 0, 0]);
    let disposed = 0;
    for (const root of [scene, player]) root.traverse((object) => {
      if (object instanceof Mesh) object.geometry.addEventListener('dispose', () => { disposed++; });
    });
    props.update(true, ['ferry']);
    expect(player.children[0]?.visible).toBe(true);
    expect(scene.children.filter((child) => child.visible).map((child) => child.name)).toEqual(['atlas-harbor-supply-ferry']);
    props.update(false, ['market', 'ferry', 'workshop']);
    expect(player.children[0]?.visible).toBe(false);
    expect(scene.children.filter((child) => child.visible)).toHaveLength(3);
    props.dispose();
    props.dispose();
    expect(disposed).toBe(8);
    expect(scene.children).toHaveLength(0);
    expect(player.children).toHaveLength(0);
  });
});
