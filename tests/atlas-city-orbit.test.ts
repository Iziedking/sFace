import { describe, expect, it } from 'vitest';
import { createIdleOrbit } from '../src/atlas/render/three/orbit';

describe('Atlas welcome orbit', () => {
  it('advances the heading slowly enough to read as drift', () => {
    // A full turn should take the better part of a minute. Faster than this and
    // the menu reads as a spinning demo rather than a place.
    const orbit = createIdleOrbit();
    const perSecond = orbit.headingAt(1) - orbit.headingAt(0);
    expect(perSecond).toBeGreaterThan(0);
    expect((Math.PI * 2) / perSecond).toBeGreaterThan(40);
  });

  it('wraps without jumping', () => {
    const orbit = createIdleOrbit();
    for (const elapsed of [0, 10, 100, 1000, 100000]) {
      const heading = orbit.headingAt(elapsed);
      expect(Number.isFinite(heading)).toBe(true);
      expect(heading).toBeGreaterThanOrEqual(0);
      expect(heading).toBeLessThan(Math.PI * 2);
    }
  });

  it('holds still under reduced motion', () => {
    // An unrequested moving background is exactly what the setting is for.
    const orbit = createIdleOrbit({ reducedMotion: true });
    expect(orbit.active).toBe(false);
    expect(orbit.headingAt(0)).toBe(orbit.headingAt(9999));
  });

  it('survives a nonsense elapsed time', () => {
    const orbit = createIdleOrbit();
    expect(orbit.headingAt(Number.NaN)).toBe(0);
    expect(orbit.headingAt(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
