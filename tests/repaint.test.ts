/**
 * Telling a repaint from a navigation.
 *
 * Mounting a screen used to replace the page's children and scroll to the top,
 * every time. That is right when the player has gone somewhere and wrong when
 * they have not, and most of the forms in this app repaint themselves after
 * every tap: pick a stake, and the page rebuilds every element under the thumb
 * that pressed it and jumps back to the heading.
 *
 * Reported as everything flashing, and as the custom amount boxes being
 * impossible to type into, because the input being typed into was destroyed
 * between one keystroke and the next.
 *
 * The DOM half of that fix cannot be tested here: there is no browser in this
 * environment, by design, so game/ stays free of one. What can be pinned is the
 * decision it turns on.
 */

import { describe, expect, it } from 'vitest';

import { isRepaint } from '../src/ui/dom';

describe('repainting the same screen', () => {
  it('is recognised when the screen has not changed', () => {
    expect(isRepaint('screen contestnew', 'screen contestnew')).toBe(true);
  });

  it('is not claimed when a different screen arrives', () => {
    // The campaign ending is why the other half still matters: the first thing
    // somebody sees after clearing the game should not be the middle of it.
    expect(isRepaint('screen contestnew', 'screen campaign')).toBe(false);
    expect(isRepaint('screen contests', 'screen contestpage')).toBe(false);
  });

  it('treats the first mount as an arrival', () => {
    // Nothing was there, so there is no position to keep and no caret to hand
    // back. An empty key must never match itself.
    expect(isRepaint('', '')).toBe(false);
    expect(isRepaint('', 'screen brief')).toBe(false);
  });
});
