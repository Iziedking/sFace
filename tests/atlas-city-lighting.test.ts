import { DirectionalLight, HemisphereLight } from 'three';
import { describe, expect, it } from 'vitest';
import { createAtlasLighting } from '../src/atlas/render/three/lighting';
import { ATLAS_WORLD_PALETTE } from '../src/atlas/palette';

describe('Atlas cartoon lighting', () => {
  it('lights the world with a hemisphere bounce and one directional sun', () => {
    const lighting = createAtlasLighting();
    expect(lighting.hemisphere).toBeInstanceOf(HemisphereLight);
    expect(lighting.sun).toBeInstanceOf(DirectionalLight);
  });

  it('keeps ambient fill below the sun so the world has contrast', () => {
    // The old pairing was ambient 1.4 against sun 1.8: near-flat, which is why
    // nothing in the city had a lit side and a shade side.
    const { hemisphere, sun } = createAtlasLighting();
    expect(hemisphere.intensity).toBeLessThan(sun.intensity);
    expect(hemisphere.intensity).toBeCloseTo(0.62);
    expect(sun.intensity).toBeCloseTo(1.2);
  });

  it('places the sun high and to one side so shadows have direction', () => {
    const { sun } = createAtlasLighting();
    expect(sun.position.y).toBeGreaterThan(sun.position.x);
    expect(sun.position.y).toBeGreaterThan(sun.position.z);
    expect(sun.position.toArray()).toEqual([6, 11, 4]);
  });

  it('takes its colours from the palette', () => {
    const { hemisphere, sun } = createAtlasLighting();
    expect(sun.color.getHex()).toBe(ATLAS_WORLD_PALETTE.sunLight);
    expect(hemisphere.color.getHex()).toBe(ATLAS_WORLD_PALETTE.sky);
    expect(hemisphere.groundColor.getHex()).toBe(ATLAS_WORLD_PALETTE.plant);
  });
});
