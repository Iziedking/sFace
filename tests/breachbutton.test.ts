/**
 * The button that opens a cell, and where a tap on it counts.
 *
 * Opening a cell costs a charge, and the only way to spend one was to find
 * CHARGE in the consumable row. The level said "TAP CHARGE TO BLOW THE DOOR",
 * which names a control without saying where it is: four small circles along
 * the bottom edge that most players never look at. Reported as not knowing
 * where to tap, with the fix attached: tap the cage.
 *
 * The failure a hit target has is being a few pixels off the thing it belongs
 * to, which happens the moment the drawing and the hit test are two copies of
 * the same arithmetic. They read this module instead, and these are its rules.
 */

import { describe, expect, it } from 'vitest';

import { breachButtonAt, breachHit } from '../src/core/breachbutton';

/** A roomy landscape phone, with a HUD strip across the top. */
const SCREEN = { width: 900, height: 420, top: 60 };

describe('where the button goes', () => {
  it('floats above the cell it belongs to', () => {
    const button = breachButtonAt({ cell: { x: 400, y: 300 }, ...SCREEN });

    expect(button.x).toBe(400);
    expect(button.y).toBeLessThan(300);
  });

  it('stays on screen when the cell is near an edge', () => {
    // A button half off the screen is a button somebody cannot press.
    const left = breachButtonAt({ cell: { x: 2, y: 300 }, ...SCREEN });
    const right = breachButtonAt({ cell: { x: 898, y: 300 }, ...SCREEN });

    expect(left.x - left.r).toBeGreaterThanOrEqual(0);
    expect(right.x + right.r).toBeLessThanOrEqual(SCREEN.width);
  });

  it('never hides under the HUD strip', () => {
    /*
     * The strip owns its own taps, including the pause control. A button drawn
     * beneath it would be invisible and would steal presses from it.
     */
    const high = breachButtonAt({ cell: { x: 400, y: 70 }, ...SCREEN });
    expect(high.y - high.r).toBeGreaterThanOrEqual(SCREEN.top);
  });

  it('never falls off the bottom either', () => {
    const low = breachButtonAt({ cell: { x: 400, y: 418 }, ...SCREEN });
    expect(low.y + low.r).toBeLessThanOrEqual(SCREEN.height);
  });
});

describe('hitting it', () => {
  const button = breachButtonAt({ cell: { x: 400, y: 300 }, ...SCREEN });

  it('counts a tap in the middle', () => {
    expect(breachHit(button, button.x, button.y)).toBe(true);
  });

  it('counts a thumb slightly off it', () => {
    // A thumb is wider than a circle, and there is nothing beside this target
    // for a loose hit to steal, so it is forgiving on purpose.
    expect(breachHit(button, button.x + button.r + 4, button.y)).toBe(true);
  });

  it('refuses a tap clearly elsewhere', () => {
    /*
     * The important half. Everything on that side of the screen is aim and
     * fire, so a target that claimed too much would make the gun stop answering
     * near a cage: a discoverability problem traded for a responsiveness one.
     */
    expect(breachHit(button, button.x + 90, button.y)).toBe(false);
    expect(breachHit(button, button.x, button.y + 90)).toBe(false);
  });

  it('is big enough for a thumb', () => {
    // Under about 44 pixels across is a target people miss.
    expect(button.r * 2).toBeGreaterThanOrEqual(44);
  });
});
