import { Color, MeshLambertMaterial } from 'three';
import { ATLAS_WORLD_PALETTE } from '../../palette';

export { ATLAS_WORLD_PALETTE as ATLAS_PALETTE } from '../../palette';
export type { AtlasWorldColour } from '../../palette';

export function createAtlasPaletteMaterials(): Readonly<Record<keyof typeof ATLAS_WORLD_PALETTE, MeshLambertMaterial>> {
  return Object.fromEntries(Object.entries(ATLAS_WORLD_PALETTE).map(([name, color]) => [name, new MeshLambertMaterial({ color: new Color(color), flatShading: true })])) as Readonly<Record<keyof typeof ATLAS_WORLD_PALETTE, MeshLambertMaterial>>;
}

export function applyAtlasMaterialStyle(material: MeshLambertMaterial): void {
  material.flatShading = true;
  material.transparent = false;
  material.depthWrite = true;
  material.needsUpdate = true;
}
