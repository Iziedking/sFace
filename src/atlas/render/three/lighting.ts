import { DirectionalLight, HemisphereLight } from 'three';
import { ATLAS_WORLD_PALETTE } from '../../palette';

export interface AtlasLighting {
  readonly hemisphere: HemisphereLight;
  readonly sun: DirectionalLight;
}

/*
 * The city used to be lit by an ambient at 1.4 and a warm directional at 1.8.
 * Two strong warm sources with nothing casting means every surface receives
 * roughly the same light, which is the whole reason the world read as flat
 * beige no matter what colour the meshes were.
 *
 * A hemisphere light is the cartoon answer to ambient: sky colour from above,
 * ground colour bounced from below, so a surface still knows which way it
 * faces. Kept deliberately below the sun's intensity, because the contrast
 * between the two is what produces a lit side and a shade side.
 */
export function createAtlasLighting(): AtlasLighting {
  const hemisphere = new HemisphereLight(ATLAS_WORLD_PALETTE.sky, ATLAS_WORLD_PALETTE.plant, 0.62);
  const sun = new DirectionalLight(ATLAS_WORLD_PALETTE.sunLight, 1.2);
  sun.position.set(6, 11, 4);
  return { hemisphere, sun };
}
