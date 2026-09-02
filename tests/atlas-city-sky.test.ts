import { describe, expect, it } from 'vitest';
import { atlasHorizonColour, atlasSkyGradientStops, createAtlasSkyTexture } from '../src/atlas/render/three/sky';
import { ATLAS_WORLD_PALETTE } from '../src/atlas/palette';

describe('Atlas sky', () => {
  it('runs from zenith to horizon in order', () => {
    const stops = atlasSkyGradientStops();
    expect(stops.length).toBeGreaterThanOrEqual(2);
    expect(stops[0]!.offset).toBe(0);
    expect(stops[stops.length - 1]!.offset).toBe(1);
    for (let index = 1; index < stops.length; index += 1) {
      expect(stops[index]!.offset).toBeGreaterThan(stops[index - 1]!.offset);
    }
  });

  it('takes every stop colour from the palette', () => {
    const known = new Set(Object.values(ATLAS_WORLD_PALETTE));
    for (const stop of atlasSkyGradientStops()) expect(known).toContain(stop.colour);
  });

  it('matches the haze to the last stop so distance reads as air', () => {
    const stops = atlasSkyGradientStops();
    expect(atlasHorizonColour()).toBe(stops[stops.length - 1]!.colour);
  });

  it('returns null rather than throwing when no canvas is available', () => {
    // The WebView can refuse a 2D context. A missing sky must degrade to the
    // solid clear colour, never take the renderer down with it.
    expect(createAtlasSkyTexture(() => null)).toBeNull();
  });
});
