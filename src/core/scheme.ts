/**
 * Which control scheme is in force, and where that choice lives.
 *
 * Persisted, because a control preference is not a per-session decision. Being
 * asked to pick your scheme again every time you open a game is the same
 * insult as being asked to pick your language again.
 *
 * Read through a getter rather than cached at import, so a change on the
 * settings screen takes effect on the very next frame without a reload or an
 * event bus. The run loop reads this every frame anyway.
 */

export type Scheme = 'touch' | 'analog' | 'dpad';

const KEY = 'sface.controls';

/**
 * Touch is the default, and stays the default.
 *
 * The floating sticks are genuinely the better scheme for most people: the
 * thumb anchors wherever it lands so nobody looks down, and the aim stick
 * reaches all three hundred and sixty degrees. Pads exist for the people that
 * does not suit, which is a real group but not the majority, and a default is
 * a recommendation whether or not it is meant as one.
 */
let current: Scheme = read();

function read(): Scheme {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === 'analog' || raw === 'dpad' || raw === 'touch' ? raw : 'touch';
  } catch {
    // Private mode, blocked storage, an embedded WebView with cookies off. A
    // control scheme is not worth failing to start a game over.
    return 'touch';
  }
}

export function scheme(): Scheme {
  return current;
}

export function setScheme(next: Scheme): void {
  current = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Kept in memory for this session, which is the best that can be done.
  }
}

/**
 * Does this device have a finger on it?
 *
 * Coarse pointer, not screen width. A narrow desktop window is still a mouse
 * and a keyboard, and a large tablet is still a thumb. Width has never been
 * the question being asked.
 */
export function touchCapable(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
}

/**
 * True when the on-screen pads should be drawn and hit-tested.
 *
 * Never on a desktop, whatever the setting says. There is a keyboard there and
 * WASD is strictly better than a thumb pad driven by a mouse, so drawing one
 * would be furniture sitting on top of the level for the whole run, obscuring
 * the thing it is supposedly helping you fly through.
 *
 * The stored preference is left alone rather than reset, so somebody who set
 * pads on their phone and later opens the same game on a laptop still has pads
 * waiting when they go back to the phone.
 */
export function usingPads(): boolean {
  return current !== 'touch' && touchCapable();
}

/** True when the movement pad snaps to eight directions. */
export function snapsToDirections(): boolean {
  return current === 'dpad';
}

export const SCHEME_LABEL: Record<Scheme, string> = {
  touch: 'Thumb anywhere',
  analog: 'Analog pad',
  dpad: 'Direction pad',
};

export const SCHEME_SAY: Record<Scheme, string> = {
  touch: 'Touch the left half to fly, the right half to aim and fire. Nothing is drawn until your thumb lands, and it lands wherever you put it.',
  analog: 'A fixed ring bottom left, a fire button bottom right, with your bombs and charges above it. Reads how far you push, like a stick.',
  dpad: 'The same layout, but the left pad snaps to eight directions. On or off, no in between, for anyone who wants to know exactly what they are going to get.',
};
