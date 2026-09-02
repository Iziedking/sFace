import { Color, MeshLambertMaterial } from 'three';

export const ATLAS_PALETTE = {
  cream: 0xf4ede0,
  paper: 0xeadfc8,
  ink: 0x14110e,
  charcoal: 0x292725,
  orange: 0xff5a1f,
  seafoam: 0x8fb3a8,
  water: 0x8fc8c2,
  leather: 0x65513b,
  plant: 0x6f8e6e,
  skin: 0xd9a27f,
  skinShadow: 0xb97758,
} as const;

export function createAtlasPaletteMaterials(): Readonly<Record<keyof typeof ATLAS_PALETTE, MeshLambertMaterial>> {
  return Object.fromEntries(Object.entries(ATLAS_PALETTE).map(([name, color]) => [name, new MeshLambertMaterial({ color: new Color(color), flatShading: true })])) as Readonly<Record<keyof typeof ATLAS_PALETTE, MeshLambertMaterial>>;
}

export function applyAtlasMaterialStyle(material: MeshLambertMaterial): void {
  material.flatShading = true;
  material.transparent = false;
  material.depthWrite = true;
  material.needsUpdate = true;
}
