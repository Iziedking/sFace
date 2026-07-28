/**
 * Fullscreen, for the desktop.
 *
 * A side-scroller in a browser tab is competing with a bookmarks bar, a tab
 * strip and whatever else is on screen. Fullscreen removes all of it, and on a
 * laptop it is the difference between looking at a web page and looking at a
 * game.
 *
 * Deliberately not offered on a phone. Mobile browsers either ignore the
 * request outright, or grant it and then hide the address bar in a way that
 * changes the viewport height mid-run, which resizes the canvas under a player
 * who is in the middle of something. The mini app is already edge to edge in
 * the wallet's WebView, so there is nothing to gain and a resize to lose.
 */

export function fullscreenAvailable(): boolean {
  if (typeof document === 'undefined') return false;
  // Coarse pointer is a good enough proxy for a phone, and being wrong here
  // only means a button appears that does nothing interesting.
  if (window.matchMedia('(pointer: coarse)').matches) return false;
  return Boolean(document.documentElement.requestFullscreen);
}

export function isFullscreen(): boolean {
  return typeof document !== 'undefined' && document.fullscreenElement !== null;
}

/** Toggle. Never throws: a refused request just leaves things as they were. */
export async function toggleFullscreen(): Promise<boolean> {
  try {
    if (isFullscreen()) {
      await document.exitFullscreen();
      return false;
    }
    await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    return true;
  } catch {
    return isFullscreen();
  }
}

/**
 * Mirror the state onto <body>, so CSS can drop page furniture in fullscreen.
 *
 * Going fullscreen is a request to see the game and nothing else, and the
 * footer belongs to the page rather than to the level. The :fullscreen selector
 * would cover a real browser on its own; the class is what gives a wallet's
 * WebView, which can be edge to edge without ever entering the fullscreen API,
 * somewhere to hook the same rule.
 */
export function syncFullscreenClass(): void {
  if (typeof document === 'undefined') return;
  document.body.classList.toggle('is-fullscreen', isFullscreen());
}

/** Fires whenever the state changes, including when the user presses Esc. */
export function onFullscreenChange(handler: () => void): void {
  if (typeof document === 'undefined') return;
  document.addEventListener('fullscreenchange', () => {
    // Synced here rather than at the call site so the class can never drift
    // out of step with the browser, including on an Escape we did not ask for.
    syncFullscreenClass();
    handler();
  });
}
