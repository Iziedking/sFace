import { Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { createBlobShadow, shadowPlanForTier } from '../src/atlas/render/three/shadows';
import { QUALITY_PROFILES } from '../shared/atlas/city/quality';

describe('Atlas shadow tiers', () => {
  it('reads the tier policy the quality profiles already declare', () => {
    expect(QUALITY_PROFILES.low.shadows).toBe('off');
    expect(QUALITY_PROFILES.balanced.shadows).toBe('contact');
    expect(QUALITY_PROFILES.high.shadows).toBe('dynamic');
  });

  it('casts real shadow maps only on the high tier', () => {
    expect(shadowPlanForTier('high').mapEnabled).toBe(true);
    expect(shadowPlanForTier('balanced').mapEnabled).toBe(false);
    expect(shadowPlanForTier('low').mapEnabled).toBe(false);
  });

  it('keeps ground contact at every tier', () => {
    // A character with no shadow floats. The low tier drops the shadow map,
    // not the contact, so the cheapest device still reads as grounded.
    expect(shadowPlanForTier('low').blobs).toBe(true);
    expect(shadowPlanForTier('balanced').blobs).toBe(true);
    expect(shadowPlanForTier('high').blobs).toBe(false);
  });

  it('sizes the shadow map for a phone', () => {
    expect(shadowPlanForTier('high').mapSize).toBe(1024);
  });

  it('builds a blob that lies flat and never casts', () => {
    const blob = createBlobShadow();
    expect(blob).toBeInstanceOf(Mesh);
    expect(blob.rotation.x).toBeCloseTo(-Math.PI / 2);
    expect(blob.castShadow).toBe(false);
    expect(blob.receiveShadow).toBe(false);
  });
});
