import { describe, expect, it } from 'vitest';

import { AtlasCamera } from '../src/atlas/render/camera';

describe('Atlas camera projection', () => {
  it('clamps a reduced-motion camera to integer world bounds', () => {
    const camera = new AtlasCamera({ reducedMotion: true });
    camera.resize({ viewportWidth: 320, viewportHeight: 700, worldWidth: 2_400, worldHeight: 1_400 });
    camera.follow({ x: 2_399, y: 1_399 });
    camera.update();
    expect(camera.view).toEqual({ x: 2_080, y: 700, width: 320, height: 700 });
    expect(camera.project({ x: 2_080, y: 700 })).toEqual({ x: 0, y: 0 });
  });

  it('smooths toward a target without leaving the viewport or producing fractions', () => {
    const camera = new AtlasCamera({ reducedMotion: false });
    camera.resize({ viewportWidth: 390, viewportHeight: 844, worldWidth: 2_400, worldHeight: 1_400 });
    camera.follow({ x: 1_200, y: 700 });
    camera.update();
    expect(camera.view.x).toBeGreaterThan(0);
    expect(camera.view.x).toBeLessThan(1_200);
    expect(Number.isInteger(camera.view.x)).toBe(true);
    expect(camera.view.x + camera.view.width).toBeLessThanOrEqual(2_400);
    expect(camera.view.y + camera.view.height).toBeLessThanOrEqual(1_400);
  });

  it('keeps a portrait-safe interaction rectangle inside the view', () => {
    const camera = new AtlasCamera({ reducedMotion: true });
    camera.resize({ viewportWidth: 430, viewportHeight: 932, worldWidth: 2_400, worldHeight: 1_400 });
    const safe = camera.interactionRect;
    expect(safe.x).toBeGreaterThanOrEqual(16);
    expect(safe.y).toBeGreaterThanOrEqual(16);
    expect(safe.x + safe.width).toBeLessThanOrEqual(430 - 16);
    expect(safe.y + safe.height).toBeLessThanOrEqual(932 - 16);
  });
});
