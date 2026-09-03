import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { QUALITY_PROFILES } from '../shared/atlas/city/quality';

const renderer = readFileSync(new URL('../src/atlas/render/three/three-renderer.ts', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/atlas/app/atlas-app.ts', import.meta.url), 'utf8');

/* The computation under test, mirrored so the arithmetic can be exercised. */
function pixelRatio(devicePixelRatio: number, maxPixelRatio: number, tier: 'low' | 'balanced' | 'high'): number {
  return Math.max(1, Math.min(devicePixelRatio, maxPixelRatio) * QUALITY_PROFILES[tier].renderScale);
}

describe('Atlas render resolution', () => {
  it('treats render scale as a fraction of the device ratio', () => {
    /*
     * The bug a playtester reported as "color is blurry": setPixelRatio was
     * handed 0.85 directly, so a phone reporting devicePixelRatio 3 drew the
     * city at 0.85 backing pixels per CSS pixel — about 28% of native — and
     * upscaled it.
     */
    expect(pixelRatio(3, 2, 'balanced')).toBeCloseTo(1.7);
    expect(pixelRatio(3, 2, 'high')).toBeCloseTo(2);
    expect(pixelRatio(3, 2, 'low')).toBeCloseTo(1.4);
  });

  it('never renders below one backing pixel per css pixel', () => {
    // Upscaling from under 1 is what made every edge soft.
    for (const tier of ['low', 'balanced', 'high'] as const) {
      expect(pixelRatio(1, 2, tier)).toBeGreaterThanOrEqual(1);
    }
  });

  it('respects a device that asks for less', () => {
    expect(pixelRatio(1, 2, 'high')).toBeCloseTo(1);
  });

  it('reads the scales from the quality profiles rather than repeating them', () => {
    // Two copies of 0.7/0.85/1 would let the governor's idea of a tier and the
    // renderer's drift apart.
    expect(renderer).toContain('QUALITY_PROFILES[this.qualityTier].renderScale');
    expect(renderer).not.toMatch(/qualityTier === 'low' \? 0\.7/);
  });

  it('asks for a backing store above one on a retina phone', () => {
    expect(app).toContain('maxPixelRatio: 2');
  });
});
