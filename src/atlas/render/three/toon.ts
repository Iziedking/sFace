import { Color, DataTexture, MeshToonMaterial, NearestFilter, RedFormat, UnsignedByteType, type Material } from 'three';

/*
 * The ramp a MeshToonMaterial samples to decide how many bands of light a
 * surface gets. Three steps is the cartoon default: lit, mid, shade.
 *
 * NearestFilter is load-bearing. With linear filtering the ramp interpolates
 * and the result is the smooth falloff this exists to replace.
 */
export function createAtlasToonGradient(steps = 3): DataTexture {
  const safeSteps = Math.max(2, Math.floor(steps));
  const data = new Uint8Array(safeSteps);
  for (let index = 0; index < safeSteps; index += 1) {
    data[index] = Math.round((index / (safeSteps - 1)) * 255);
  }
  const texture = new DataTexture(data, safeSteps, 1, RedFormat, UnsignedByteType);
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

const sharedGradient = createAtlasToonGradient(3);

export function toAtlasToonMaterial(source: Material): Material {
  const coloured = source as Material & { color?: Color };
  if (!(coloured.color instanceof Color)) return source;
  const toon = new MeshToonMaterial({
    color: coloured.color.clone(),
    gradientMap: sharedGradient,
  });
  toon.name = source.name;
  toon.side = source.side;
  toon.transparent = source.transparent;
  toon.opacity = source.opacity;
  toon.needsUpdate = true;
  return toon;
}
