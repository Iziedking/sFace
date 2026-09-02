import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
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

  it('keeps text on every saturated fill above the AA floor', () => {
    /*
     * The gap that let a real regression through.
     *
     * The earlier version of this file only checked text on glass. Ten surfaces
     * use an accent as a full background — the path cards, the role buttons,
     * the checked answers, the lantern status — and --atlas-ink is near-white
     * because glass is dark. On explorer gold that is 1.37:1. It was fine while
     * ink was near-black and broke the moment the palette inverted.
     */
    for (const fill of ['atlas-explorer', 'atlas-builder', 'atlas-warn', 'atlas-verified', 'atlas-signal'] as const) {
      const ratio = contrastRatio(ATLAS_UI_TOKENS['atlas-on-accent'], ATLAS_UI_TOKENS[fill]);
      expect(ratio, `--atlas-on-accent on --${fill} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('never leaves the glass ink on a saturated fill', () => {
    // If this ever passes for --atlas-ink too, the two inks have converged and
    // one of them is wrong.
    expect(contrastRatio(ATLAS_UI_TOKENS['atlas-ink'], ATLAS_UI_TOKENS['atlas-explorer'])).toBeLessThan(4.5);
  });
});

describe('Atlas ink follows its surface', () => {
  const css = readFileSync(new URL('../src/atlas/atlas.css', import.meta.url), 'utf8');

  it('restores the glass ink wherever a control drops the accent fill', () => {
    /*
     * The mirror image of the accent-contrast bug, and it shipped for one
     * screenshot: .atlas-screen-nav .atlas-primary overrides the magenta fill
     * back to dark glass but inherited --atlas-on-accent, so "Atlas home" was
     * dark navy on dark navy — a capsule with nothing in it.
     *
     * Any rule that changes .atlas-primary's background must say which ink goes
     * with it.
     */
    const overrides = [...css.matchAll(/^[^\n{]*\.atlas-primary[^\n{]*\{([^}]*background:[^}]*)\}/gm)];
    expect(overrides.length).toBeGreaterThan(0);
    for (const [rule, body] of overrides) {
      const selector = rule.slice(0, rule.indexOf('{')).trim();
      if (selector === '.atlas-primary') continue;
      expect(body, `${selector} sets a background without an ink`).toMatch(/color:/);
    }
  });
});
