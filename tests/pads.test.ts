/**
 * The pad layout, which two very different pieces of code have to agree about.
 *
 * The renderer draws from it and the input layer hit-tests against it. If they
 * ever disagreed the failure would be the worst kind of UI bug: the button is
 * visibly there, the player presses it, and nothing happens. These tests pin
 * the properties that make that impossible.
 */

import { describe, expect, it } from 'vitest';

import { hit, padLayout, padVector, slotStrip } from '../src/core/pads';
import { Input } from '../src/core/input';
import { setScheme } from '../src/core/scheme';

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

/**
 * The right thumb has to be able to aim, not only fire.
 *
 * Reported from a phone as shooting pointing one direction and not responding to
 * control. The fire pad was a pure button: its pointer was grabbed on press and
 * every move event for that pointer returned early, so aimVector was never set
 * from a pad. The only aim source left on a touch device was the direction of
 * travel, so standing still to take a shot, which is what you do at every corner
 * in a city, left the gun stuck on its last heading.
 *
 * Driven through the real listeners rather than by poking internals, because the
 * bug lived in the event plumbing: a test that called a method directly would
 * have passed against the broken version.
 *
 * There is no DOM here and deliberately no jsdom either. Input binds to exactly
 * two targets, so standing both of them up by hand is a dozen lines and costs the
 * project no dependency the day before a deadline.
 */
describe('aiming with a thumb', () => {
  type Handler = (event: unknown) => void;

  function harness() {
    const handlers = new Map<string, Handler[]>();
    const record = (type: string, fn: Handler): void => {
      const list = handlers.get(type) ?? [];
      list.push(fn);
      handlers.set(type, list);
    };
    const target = {
      addEventListener: (type: string, fn: Handler) => record(type, fn),
      removeEventListener: () => {},
      clientWidth: PHONE.w,
      clientHeight: PHONE.h,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: PHONE.w, height: PHONE.h }),
      // scheme.ts asks whether the device has a coarse pointer before deciding
      // the pads are in force, so the stub has to answer as a phone.
      matchMedia: () => ({ matches: true }),
    };

    const previous = (globalThis as Record<string, unknown>).window;
    (globalThis as Record<string, unknown>).window = target;

    const input = new Input(target as unknown as HTMLCanvasElement);
    input.slotCount = 4;
    // 'analog' is the ring; 'dpad' is the same footprint. Either puts the pads in
    // force, which is what these cases are about.
    setScheme('analog');

    const send = (type: string, id: number, x: number, y: number): void => {
      for (const fn of handlers.get(type) ?? []) {
        fn({ pointerId: id, clientX: x, clientY: y, preventDefault: () => {} });
      }
    };

    const restore = (): void => {
      (globalThis as Record<string, unknown>).window = previous;
    };

    return { input, send, restore, pads: padLayout(PHONE.w, PHONE.h, 4) };
  }

  it('turns the gun when the fire thumb pushes, and keeps firing', () => {
    const { input, send, restore, pads } = harness();
    try {
      send('pointerdown', 1, pads.fire.x, pads.fire.y);
      expect(input.firing).toBe(true);

      send('pointermove', 1, pads.fire.x - 60, pads.fire.y);
      expect(input.aimVector).not.toBeNull();
      expect(input.aimVector!.x).toBeLessThan(-0.9);
      expect(input.firing).toBe(true);

      // And now up: the gun has to follow, not hold the old heading.
      send('pointermove', 1, pads.fire.x, pads.fire.y - 60);
      expect(input.aimVector!.y).toBeLessThan(-0.9);
    } finally {
      restore();
    }
  });

  it('holds the last heading when the thumb lifts', () => {
    const { input, send, restore, pads } = harness();
    try {
      send('pointerdown', 1, pads.fire.x, pads.fire.y);
      send('pointermove', 1, pads.fire.x + 60, pads.fire.y);
      const held = { ...input.aimVector! };

      send('pointerup', 1, pads.fire.x + 60, pads.fire.y);

      expect(input.firing).toBe(false);
      expect(input.aimVector).toEqual(held);
    } finally {
      restore();
    }
  });

  it('lets the move thumb steer while the fire thumb aims', () => {
    // Two thumbs down at once is the normal state of play, and neither may
    // steal the other's control.
    const { input, send, restore, pads } = harness();
    try {
      send('pointerdown', 1, pads.move.x, pads.move.y);
      send('pointerdown', 2, pads.fire.x, pads.fire.y);

      send('pointermove', 1, pads.move.x + 50, pads.move.y);
      send('pointermove', 2, pads.fire.x, pads.fire.y + 60);

      expect(input.move.x).toBeGreaterThan(0.5);
      expect(input.aimVector!.y).toBeGreaterThan(0.9);
    } finally {
      restore();
    }
  });
});

/**
 * The consumable row for the floating-stick scheme.
 *
 * These four were drawn in the top strip and hit-tested nowhere, so on a phone
 * they were decoration: visible, priced, numbered, and impossible to press. The
 * row exists to give them a thumb, and it is only worth anything if it stays
 * out of the way of the two sticks it sits between.
 */
describe('the bottom row of buys', () => {
  it('centres itself whatever the count', () => {
    for (const count of [1, 2, 3, 4]) {
      const strip = slotStrip(PHONE.w, PHONE.h, count);
      expect(strip).toHaveLength(count);

      const middle = (strip[0]!.x + strip[strip.length - 1]!.x) / 2;
      expect(middle).toBeCloseTo(PHONE.w / 2, 5);
    }
  });

  it('never puts two buttons close enough to catch the wrong one', () => {
    // The same rule the pad arc has to hold. A thumb aiming for one and taking
    // its neighbour reads as the game buying something you did not ask for.
    const strip = slotStrip(PHONE.w, PHONE.h, 4);

    for (let i = 1; i < strip.length; i++) {
      const gap = strip[i]!.x - strip[i - 1]!.x;
      expect(gap).toBeGreaterThan(strip[i]!.r * 2);
    }
  });

  it('sits clear of both thumbs', () => {
    /*
     * The whole reason this band was chosen. In landscape the hands are at the
     * corners and the middle of the bottom edge is bridged by the phone, so a
     * button there is reached deliberately and never by accident.
     */
    const pads = padLayout(PHONE.w, PHONE.h, 4);
    const strip = slotStrip(PHONE.w, PHONE.h, 4);

    for (const slot of strip) {
      expect(Math.hypot(slot.x - pads.move.x, slot.y - pads.move.y)).toBeGreaterThan(
        slot.r + pads.move.r,
      );
      expect(Math.hypot(slot.x - pads.fire.x, slot.y - pads.fire.y)).toBeGreaterThan(
        slot.r + pads.fire.r,
      );
    }
  });

  it('stays on screen', () => {
    for (const size of [PHONE, NARROW]) {
      for (const slot of slotStrip(size.w, size.h, 4)) {
        expect(slot.x - slot.r).toBeGreaterThan(0);
        expect(slot.x + slot.r).toBeLessThan(size.w);
        expect(slot.y + slot.r).toBeLessThan(size.h);
      }
    }
  });

  it('asks for nothing when there is nothing to buy', () => {
    expect(slotStrip(PHONE.w, PHONE.h, 0)).toHaveLength(0);
  });
});
