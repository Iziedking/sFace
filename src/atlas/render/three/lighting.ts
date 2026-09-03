import { DirectionalLight, HemisphereLight } from 'three';
import { ATLAS_WORLD_PALETTE } from '../../palette';

export interface AtlasLighting {
  readonly hemisphere: HemisphereLight;
  readonly sun: DirectionalLight;
  /*
   * A cool light from behind and above, opposite the sun.
   *
   * It exists for silhouettes. A toon-shaded figure standing on ground of a
   * similar value has almost no edge to read, which is a large part of why a
   * playtester called the characters poor: not the geometry, the fact that they
   * did not separate from what was behind them. A rim catches the top and
   * shoulders and gives the figure an edge without lighting the scene.
   *
   * It casts nothing, so it costs one more light and no shadow pass.
   */
  readonly rim: DirectionalLight;
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
  const rim = new DirectionalLight(ATLAS_WORLD_PALETTE.water, 0.85);
  rim.position.set(-7, 6, -8);
  rim.castShadow = false;
  return { hemisphere, sun, rim };
}
