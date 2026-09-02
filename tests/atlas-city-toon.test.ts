import { Color, DataTexture, MeshBasicMaterial, MeshStandardMaterial, MeshToonMaterial, NearestFilter } from 'three';
import { describe, expect, it } from 'vitest';
import { createAtlasToonGradient, toAtlasToonMaterial } from '../src/atlas/render/three/toon';

describe('Atlas toon shading', () => {
  it('builds a hard-stepped gradient, not a smooth one', () => {
    // Nearest filtering is the whole point: linear filtering turns the ramp
    // back into the smooth falloff this replaces.
    const gradient = createAtlasToonGradient(3);
    expect(gradient).toBeInstanceOf(DataTexture);
    expect(gradient.image.width).toBe(3);
    expect(gradient.magFilter).toBe(NearestFilter);
    expect(gradient.minFilter).toBe(NearestFilter);
  });

  it('steps from dark to light across the ramp', () => {
    const data = createAtlasToonGradient(3).image.data as Uint8Array;
    expect(data[0]!).toBeLessThan(data[1]!);
    expect(data[1]!).toBeLessThan(data[2]!);
  });

  it('carries colour, name and side onto the toon material', () => {
    const source = new MeshStandardMaterial({ color: new Color(0x8fb3a8), name: 'seafoam' });
    source.transparent = true;
    const toon = toAtlasToonMaterial(source);
    expect(toon).toBeInstanceOf(MeshToonMaterial);
    expect((toon as MeshToonMaterial).color.getHex()).toBe(0x8fb3a8);
    expect(toon.name).toBe('seafoam');
    expect(toon.transparent).toBe(true);
  });

  it('leaves a material with no colour alone', () => {
    // Emissive beams use materials that must not be shaded at all.
    const source = new MeshBasicMaterial();
    Reflect.deleteProperty(source, 'color');
    expect(toAtlasToonMaterial(source)).toBe(source);
  });
});
