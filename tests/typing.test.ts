/**
 * The game keyboard, and every text field in the app.
 *
 * ## The bug this file exists for
 *
 * The key listeners are on the window and are never taken off, because the
 * player can be at the keyboard on any screen. So every key the game claimed
 * was claimed everywhere, whatever had focus.
 *
 * Space fired the gun and was swallowed. One to four bought consumables and
 * were swallowed. On a screen with a text field that meant a sentence typed
 * into the room arrived with every space missing, as one run-on word, and a
 * number field refused 1, 2, 3 and 4, so a custom stake could only be built out
 * of the digits the game had not taken.
 *
 * Nothing threw and nothing logged. It reached a real player, who reported it
 * as "space not working" and "only 0 types", which are the same bug wearing two
 * hats. That is why these are tested against the handler rather than left to a
 * screenshot to catch.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Input } from '../src/core/input';

/**
 * A window and a canvas, in Node.
 *
 * This suite is about a listener on the window, so there has to be one. Rather
 * than pull in a whole DOM, the two things Input actually touches at
 * construction are stood up here: something to add listeners to, and a canvas
 * to add pointer listeners to. Nothing else about a browser is needed, and
 * inventing more of one would be inventing behaviour to test against.
 */
function stubDom(): () => void {
  const listeners = new Map<string, Set<EventListener>>();
  const target = {
    addEventListener(type: string, handler: EventListener) {
      const set = listeners.get(type) ?? new Set();
      set.add(handler);
      listeners.set(type, set);
    },
    removeEventListener(type: string, handler: EventListener) {
      listeners.get(type)?.delete(handler);
    },
  };

  const globals = globalThis as unknown as Record<string, unknown>;
  const had = 'window' in globals;
  const before = globals.window;
  globals.window = target;

  return () => {
    if (had) globals.window = before;
    else delete globals.window;
  };
}

const CANVAS_STUB = {
  addEventListener: () => {},
  removeEventListener: () => {},
} as unknown as HTMLCanvasElement;

/**
 * A keydown as the browser would deliver it, with a target.
 *
 * The real listener reads `event.target`, which is the focused element, so the
 * whole question here is what that element is.
 */
function keydown(code: string, target: unknown) {
  let defaultPrevented = false;
  return {
    event: {
      code,
      repeat: false,
      target,
      preventDefault: () => {
        defaultPrevented = true;
      },
    },
    wasPrevented: () => defaultPrevented,
  };
}

/** A stand-in for the focused element. Only the tag and flag are ever read. */
function element(tagName: string, contentEditable = false) {
  return { tagName, isContentEditable: contentEditable };
}

const CANVAS = element('CANVAS');
const FIELD = element('INPUT');

/**
 * Reach the window listener the Input class installed.
 *
 * Deliberately not calling a method: the thing that was broken is what happens
 * when a real keydown arrives, so what is exercised is the real handler as it
 * is actually wired up.
 */
function handlersFor(input: Input): { down: (e: unknown) => void; up: (e: unknown) => void } {
  const bag = input as unknown as {
    onKeyDown: (e: unknown) => void;
    onKeyUp: (e: unknown) => void;
  };
  return { down: bag.onKeyDown, up: bag.onKeyUp };
}

let input: Input;
let keys: { down: (e: unknown) => void; up: (e: unknown) => void };
let restoreDom: () => void;

beforeEach(() => {
  restoreDom = stubDom();
  input = new Input(CANVAS_STUB);
  keys = handlersFor(input);
});

afterEach(() => {
  restoreDom();
});

describe('typing into a field', () => {
  it('lets a space through', () => {
    // The one that reached a player. Every space in a sentence was eaten, and
    // the message arrived as one word with no error anywhere.
    const { event, wasPrevented } = keydown('Space', FIELD);
    keys.down(event);
    expect(wasPrevented()).toBe(false);
  });

  it('lets the digits the game uses through', () => {
    // 1 to 4 buy consumables. A number field could only be filled out of 0 and
    // 5 to 9, which is why a custom amount read as "only 0 types".
    for (const code of ['Digit1', 'Digit2', 'Digit3', 'Digit4']) {
      const { event, wasPrevented } = keydown(code, FIELD);
      keys.down(event);
      expect(wasPrevented()).toBe(false);
    }
  });

  it('lets the use key through', () => {
    const { event, wasPrevented } = keydown('KeyE', FIELD);
    keys.down(event);
    expect(wasPrevented()).toBe(false);
  });

  it('does not fire the gun', () => {
    keys.down(keydown('Space', FIELD).event);
    expect(input.firing).toBe(false);
  });

  it('does not buy anything', () => {
    keys.down(keydown('Digit2', FIELD).event);
    expect(input.takeBuys()).toEqual([]);
  });

  it('does not fly the ship', () => {
    // Typing a word with a D in it used to steer. Worse, the key was recorded,
    // so it could stay held after the field was left.
    keys.down(keydown('KeyD', FIELD).event);
    expect(input.move.x).toBe(0);
  });

  it('treats a textarea and an editable box the same way', () => {
    for (const target of [element('TEXTAREA'), element('DIV', true), element('SELECT')]) {
      const { event, wasPrevented } = keydown('Space', target);
      keys.down(event);
      expect(wasPrevented()).toBe(false);
    }
  });
});

describe('playing the game', () => {
  it('still fires on space', () => {
    const { event, wasPrevented } = keydown('Space', CANVAS);
    keys.down(event);

    expect(input.firing).toBe(true);
    // Prevented, or the page scrolls under the run every time you shoot.
    expect(wasPrevented()).toBe(true);
  });

  it('still buys on the number keys', () => {
    keys.down(keydown('Digit3', CANVAS).event);
    expect(input.takeBuys()).toEqual([2]);
  });

  it('still flies', () => {
    keys.down(keydown('KeyD', CANVAS).event);
    expect(input.move.x).toBe(1);
  });

  it('still takes a key with no target at all', () => {
    // Some synthetic events carry none. Refusing those would break the game on
    // whatever dispatches them, and there is no field to protect.
    keys.down(keydown('Space', null).event);
    expect(input.firing).toBe(true);
  });
});

describe('a key held across the two', () => {
  it('is let go of even if it comes up over a field', () => {
    /*
     * The asymmetry that makes this safe. Keydown is ignored while typing, but
     * keyup is not: press D on the game, click into a box, release it there,
     * and without this the ship flies right forever.
     */
    keys.down(keydown('KeyD', CANVAS).event);
    expect(input.move.x).toBe(1);

    keys.up(keydown('KeyD', FIELD).event);
    expect(input.move.x).toBe(0);
  });

  it('stops firing the same way', () => {
    keys.down(keydown('Space', CANVAS).event);
    keys.up(keydown('Space', FIELD).event);
    expect(input.firing).toBe(false);
  });
});
