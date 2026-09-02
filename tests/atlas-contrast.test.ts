import { describe, expect, it } from 'vitest';
import { contrastRatio, flattenOver } from '../src/atlas/contrast';
import { ATLAS_UI_TOKENS, ATLAS_WORLD_PALETTE, worldColourCss } from '../src/atlas/palette';

// The city's sky is the brightest backdrop a panel can ever sit on, so it is
// the worst case for a translucent dark panel.
const brightestBackdrop = worldColourCss('sky');
const glassOverSky = flattenOver(ATLAS_UI_TOKENS['atlas-paper'], brightestBackdrop);

describe('Atlas contrast', () => {
  it('computes the known WCAG extremes', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 2);
  });

  it('composites a translucent layer over an opaque base', () => {
    expect(flattenOver('rgba(0, 0, 0, 1)', '#ffffff')).toBe('#000000');
    expect(flattenOver('rgba(0, 0, 0, 0)', '#ffffff')).toBe('#ffffff');
  });

  it('takes the worst case from the world, not from a guess', () => {
    expect(ATLAS_WORLD_PALETTE.sky).toBe(0x4cc9f0);
  });

  it('keeps body text readable on glass over the brightest thing the city can show', () => {
    // 4.5 is the WCAG AA floor for body text.
    expect(contrastRatio(ATLAS_UI_TOKENS['atlas-ink'], glassOverSky)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps supporting copy readable on the same glass', () => {
    expect(contrastRatio(ATLAS_UI_TOKENS['atlas-muted'], glassOverSky)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps section labels readable on the same glass', () => {
    expect(contrastRatio(ATLAS_UI_TOKENS['atlas-label'], glassOverSky)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the primary action legible against its own label', () => {
    expect(contrastRatio(ATLAS_UI_TOKENS['atlas-ink'], ATLAS_UI_TOKENS['atlas-signal'])).toBeGreaterThanOrEqual(3);
  });
});
