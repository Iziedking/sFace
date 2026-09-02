import { readFileSync } from 'node:fs';
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

describe('Atlas orbit is confined to the welcome screen', () => {
  const app = readFileSync(new URL('../src/atlas/app/atlas-app.ts', import.meta.url), 'utf8');

  it('drives the camera only while the welcome screen is showing', () => {
    /*
     * The first wiring cleared a flag in screenPanel, which the two play shells
     * never call by design, so the drift carried on into gameplay and fought
     * the follow camera. Deriving it from the screen removes the coupling
     * between "which screens are sheets" and "which screen orbits".
     */
    const start = app.indexOf('idleHeading:');
    expect(start, 'idleHeading is missing').toBeGreaterThan(-1);
    const body = app.slice(start, start + 700);
    expect(body).toContain("this.screen !== 'welcome'");
  });

  it('does not depend on screenPanel to stop the drift', () => {
    const start = app.indexOf('idleHeading:');
    const body = app.slice(start, start + 700);
    expect(body).toContain('return null');
  });
});
