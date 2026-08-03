/**
 * How much world each shape of screen gets, and what sits above the ship.
 *
 * Two separate faults, both reported as the same thing: on a phone held
 * sideways you cannot see what is coming, and characters climb off the top of
 * the screen.
 *
 * The first was the width cap. It was applied as a floor on the scale, forcing
 * a wide screen to zoom IN until it saw no more than 1200 units across, and on
 * a short screen the cost came out of the only axis it had none of. A landscape
 * phone was left with about 440 world units of height while a desktop had 663,
 * so the rule written to keep the game fair was handing the desktop half as
 * much sky again.
 *
 * The second was the downward bias. Chasing the ground is right until it costs
 * you the thing shooting at you: at a flat third of the view the ship sat 18%
 * from the top of the frame, which on a landscape phone is two characters of
 * warning against attackers that dive.
 */

import { describe, expect, it } from 'vitest';

import { Camera } from '../src/render/camera';

/** Roughly what each device leaves for the canvas once its chrome is out. */
const DEVICES = {
  wallet: [670, 200],
  iphoneLandscape: [844, 330],
  pixelLandscape: [915, 350],
  reported: [1280, 470],
  iphonePortrait: [390, 700],
  desktop: [1990, 1100],
} as const;

function viewOf(css: readonly [number, number]) {
  const camera = new Camera();
  camera.resize(css[0], css[1]);
  return { w: camera.viewW, h: camera.viewH, area: camera.viewW * camera.viewH };
}

/** Sky above the ship when flying high, which is the case that was reported. */
function skyAbove(css: readonly [number, number]): number {
  const camera = new Camera();
  camera.resize(css[0], css[1]);

  // Well clear of the ground, so the bias sits on whichever cap binds it.
  const player = { x: 4_000, y: 200, vx: 0, vy: 0 } as never;
  camera.jumpTo(player, 900);

  return 200 - (camera.y - camera.viewH / 2);
}

describe('what sits above the ship', () => {
  it('is never less than five character heights, on any screen', () => {
    /*
     * The invariant the whole change exists for. A character is about forty
     * units, so this is five of them: enough to see a diver commit before it
     * arrives, which is the least a game where the threat comes from above can
     * offer.
     */
    for (const [name, css] of Object.entries(DEVICES)) {
      expect(skyAbove(css), name).toBeGreaterThanOrEqual(195);
    }
  });

  it('gives a landscape phone what it used to give a desktop', () => {
    // Both were around eighty units before. The point is that they now agree,
    // rather than the desktop being comfortable while the phone was not.
    const phone = skyAbove(DEVICES.pixelLandscape);
    const desktop = skyAbove(DEVICES.desktop);
    expect(Math.abs(phone - desktop)).toBeLessThan(30);
  });

  it('still keeps the ground within reach', () => {
    // The bias exists so the chart stays on screen, and capping it must not
    // undo that: the chart is the terrain and the entire premise.
    for (const [name, css] of Object.entries(DEVICES)) {
      const camera = new Camera();
      camera.resize(css[0], css[1]);
      const player = { x: 4_000, y: 200, vx: 0, vy: 0 } as never;
      camera.jumpTo(player, 900);

      const below = camera.y + camera.viewH / 2 - 200;
      expect(below, name).toBeGreaterThan(200);
    }
  });
});

describe('how much world each screen sees', () => {
  it('gives every ordinary screen the same total', () => {
    /*
     * Area is the fairness rule, and it was not being applied: the width cap
     * bound first on every wide screen, so a desktop saw 796,000 units against
     * a landscape phone's 529,000. Same shape of level, half as much again of
     * it, in a game where two people bet NIM on one seed.
     */
    const desktop = viewOf(DEVICES.desktop).area;
    const phone = viewOf(DEVICES.pixelLandscape).area;
    expect(Math.abs(desktop - phone) / desktop).toBeLessThan(0.02);
  });

  it('lets a wide screen buy reach with sky, not with both', () => {
    // A short window sees further along the level and less of the air above it.
    // That is a trade rather than an advantage, which is what equal area means.
    const wide = viewOf(DEVICES.reported);
    const tall = viewOf(DEVICES.desktop);

    expect(wide.w).toBeGreaterThan(tall.w);
    expect(wide.h).toBeLessThan(tall.h);
  });

  it('draws less on the screen least able to draw', () => {
    // The wallet in landscape is a phone inside a WebView, and the budget there
    // is deliberately smaller: sky bought at the cost of the frame rate is the
    // worse of the two trades. See CRAMPED_VIEW_AREA.
    expect(viewOf(DEVICES.wallet).area).toBeLessThan(viewOf(DEVICES.desktop).area);
  });

  it('never lets an absurd aspect ratio see the whole level', () => {
    // 32:9 exists. The guard is the only thing the old width cap is still for.
    const silly = viewOf([3840, 1080]);
    expect(silly.w).toBeLessThanOrEqual(1700);
  });
});
