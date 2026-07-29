/**
 * The pad layout, which two very different pieces of code have to agree about.
 *
 * The renderer draws from it and the input layer hit-tests against it. If they
 * ever disagreed the failure would be the worst kind of UI bug: the button is
 * visibly there, the player presses it, and nothing happens. These tests pin
 * the properties that make that impossible.
 */

import { describe, expect, it } from 'vitest';

import { hit, padLayout, padVector } from '../src/core/pads';

const PHONE = { w: 844, h: 390 }; // a phone in landscape
const NARROW = { w: 390, h: 844 }; // the same phone upright

describe('the layout keeps controls reachable and apart', () => {
  it('puts movement on the left and fire on the right', () => {
    const pads = padLayout(PHONE.w, PHONE.h, 4);
    expect(pads.move.x).toBeLessThan(PHONE.w / 2);
    expect(pads.fire.x).toBeGreaterThan(PHONE.w / 2);
  });

  it('keeps every control fully on screen, in both orientations', () => {
    for (const { w, h } of [PHONE, NARROW]) {
      const pads = padLayout(w, h, 4);
      for (const region of [pads.move, pads.fire, ...pads.slots]) {
        expect(region.x - region.r).toBeGreaterThanOrEqual(0);
        expect(region.x + region.r).toBeLessThanOrEqual(w);
        expect(region.y - region.r).toBeGreaterThanOrEqual(0);
        expect(region.y + region.r).toBeLessThanOrEqual(h);
      }
    }
  });

  it('never overlaps the fire button with a consumable', () => {
    const pads = padLayout(PHONE.w, PHONE.h, 4);
    for (const slot of pads.slots) {
      const gap = Math.hypot(slot.x - pads.fire.x, slot.y - pads.fire.y);
      expect(gap).toBeGreaterThan(slot.r + pads.fire.r);
    }
  });

  it('never overlaps two consumables with each other', () => {
    const pads = padLayout(PHONE.w, PHONE.h, 4);
    for (let i = 0; i < pads.slots.length; i++) {
      for (let j = i + 1; j < pads.slots.length; j++) {
        const a = pads.slots[i]!;
        const b = pads.slots[j]!;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(a.r + b.r);
      }
    }
  });

  it('never overlaps movement with fire', () => {
    const pads = padLayout(PHONE.w, PHONE.h, 4);
    const gap = Math.hypot(pads.move.x - pads.fire.x, pads.move.y - pads.fire.y);
    expect(gap).toBeGreaterThan(pads.move.r + pads.fire.r);
  });
});

describe('a press lands where the button is drawn', () => {
  it('registers at the centre and just inside the edge', () => {
    const pads = padLayout(PHONE.w, PHONE.h, 4);
    expect(hit(pads.fire, pads.fire.x, pads.fire.y)).toBe(true);
    expect(hit(pads.fire, pads.fire.x + pads.fire.r - 1, pads.fire.y)).toBe(true);
  });

  it('does not register well outside it', () => {
    const pads = padLayout(PHONE.w, PHONE.h, 4);
    expect(hit(pads.fire, pads.fire.x - pads.fire.r * 3, pads.fire.y)).toBe(false);
  });
});

describe('the movement pad', () => {
  it('reads nothing from a thumb resting in the middle', () => {
    const pads = padLayout(PHONE.w, PHONE.h, 4);
    const v = padVector(pads.move, pads.move.x, pads.move.y, false);
    expect(v).toEqual({ x: 0, y: 0 });
  });

  it('reads full tilt at the rim, and never above it', () => {
    const pads = padLayout(PHONE.w, PHONE.h, 4);
    const v = padVector(pads.move, pads.move.x + pads.move.r * 2, pads.move.y, false);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1, 5);
  });

  it('shades between the two on analog', () => {
    const pads = padLayout(PHONE.w, PHONE.h, 4);
    const half = padVector(pads.move, pads.move.x + pads.move.r * 0.45, pads.move.y, false);
    const full = padVector(pads.move, pads.move.x + pads.move.r, pads.move.y, false);
    expect(Math.hypot(half.x, half.y)).toBeLessThan(Math.hypot(full.x, full.y));
  });

  it('snaps to eight directions on a d-pad, and is always full tilt', () => {
    const pads = padLayout(PHONE.w, PHONE.h, 4);
    // A thumb slightly off true right must read as exactly right.
    const v = padVector(pads.move, pads.move.x + 40, pads.move.y + 3, true);
    expect(v.x).toBeCloseTo(1, 5);
    expect(v.y).toBeCloseTo(0, 5);

    // And a d-pad is on or off, never shaded.
    const near = padVector(pads.move, pads.move.x + 20, pads.move.y, true);
    expect(Math.hypot(near.x, near.y)).toBeCloseTo(1, 5);
  });

  it('gives a real diagonal rather than a nearly-diagonal', () => {
    const pads = padLayout(PHONE.w, PHONE.h, 4);
    const v = padVector(pads.move, pads.move.x + 40, pads.move.y + 34, true);
    expect(Math.abs(v.x)).toBeCloseTo(Math.abs(v.y), 5);
  });
});
