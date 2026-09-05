import { BoxGeometry, Group, Mesh, MeshStandardMaterial, type Object3D } from 'three';
import type { HarborContractKind } from '../../../../shared/atlas/harbor-contracts';
import { ATLAS_WORLD_PALETTE } from '../../palette';

/** Small owned props: no asset fetch, animation loop, or saved state in the renderer. */
export function createHarborSupplies(scene: Object3D, player: Object3D, market: readonly [number, number, number]) {
  const resources: Mesh[] = [];
  function parcel(name: string): Group {
    const group = new Group();
    group.name = name;
    const box = new Mesh(new BoxGeometry(0.42, 0.32, 0.34), new MeshStandardMaterial({ color: ATLAS_WORLD_PALETTE.stationWarm, roughness: 0.9 }));
    const band = new Mesh(new BoxGeometry(0.08, 0.33, 0.35), new MeshStandardMaterial({ color: ATLAS_WORLD_PALETTE.stationGold, roughness: 0.8 }));
    resources.push(box, band);
    group.add(box, band);
    group.visible = false;
    return group;
  }
  const cargo = parcel('atlas-harbor-contract-cargo');
  cargo.position.set(0, 0.9, 0.35);
  player.add(cargo);
  const kinds: readonly HarborContractKind[] = ['market', 'ferry', 'workshop'];
  const supplies = kinds.map((kind, index) => {
    const prop = parcel(`atlas-harbor-supply-${kind}`);
    prop.position.set(market[0] + 0.6 + index * 0.5, market[1] + 0.16, market[2] + 0.6);
    scene.add(prop);
    return prop;
  });
  let disposed = false;
  return {
    update(carried: boolean, stocked: readonly HarborContractKind[]): void {
      if (disposed) return;
      cargo.visible = carried;
      supplies.forEach((prop, index) => { prop.visible = stocked.includes(kinds[index]!); });
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      cargo.removeFromParent();
      supplies.forEach((prop) => prop.removeFromParent());
      resources.forEach((mesh) => { mesh.geometry.dispose(); (mesh.material as MeshStandardMaterial).dispose(); });
    },
  };
}
