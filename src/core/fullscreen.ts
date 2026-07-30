/**
 * Fullscreen, on anything that will grant it.
 *
 * A game in a browser tab competes with an address bar, a tab strip and a set of
 * navigation buttons. Removing them is the difference between looking at a web
 * page and looking at a game, and on a phone it is worth more than on a laptop
 * because the bars eat a far larger share of a small screen.
 *
 * ## This used to be refused on phones, and that was wrong
 *
 * The old rule was: coarse pointer, no fullscreen. The stated reason was that
 * mobile browsers hide the address bar on their own and resize the viewport
 * mid-run. That does happen, but the canvas already handles resize, and refusing
 * the request means the address bar stays there for the whole run instead. The
 * cure was worse than the problem.
 *
 * ## The platforms genuinely differ
 *
 * Android browsers implement the Fullscreen API on ordinary elements, so the
 * button works and the result is a real fullscreen game.
 *
 * iOS Safari does not. `requestFullscreen` exists on video elements and nothing
 * else, so no amount of asking will remove Safari's chrome. The only route there
 * is Add to Home Screen, which launches standalone with no browser furniture at
 * all; the manifest already declares that. So on iOS the honest thing is to say
 * so rather than to show a button that does nothing.
 *
 * Inside Nimiq Pay none of this arises. The WebView is already edge to edge.
 */

/**
 * True when the app is running inside a wallet's WebView rather than a browser.
 *
 * Detected from the host SDK having answered, which is the only honest signal:
 * a WebView is a browser as far as feature detection is concerned, so nothing
 * about the DOM distinguishes one.
 */
function inHostApp(): boolean {
  return Boolean((window as unknown as { __sfaceInHost?: boolean }).__sfaceInHost);
}

export function fullscreenAvailable(): boolean {
  if (typeof document === 'undefined') return false;

  /*
   * Never offered inside Nimiq Pay.
   *
   * The wallet draws its own header above the WebView: a close button, the
   * address, and navigation controls. Those belong to the host app and no web
   * API can remove them, so the Fullscreen API here either fails silently or
   * expands the page inside a frame that still has a bar on top of it.
   *
   * Reported as fullscreen not working in the Nimiq app, and it never could. A
   * button that cannot do the thing it names is worse than no button, so it is
   * not shown there.
   */
  if (inHostApp()) return false;

  /*
   * Feature detection, not device sniffing.
   *
   * Asking whether the method exists is both simpler and more accurate than
   * guessing from the pointer type, and it is what correctly excludes iOS
   * without excluding every phone along with it.
   */
  return typeof document.documentElement.requestFullscreen === 'function';
}

/**
 * True on a device where fullscreen is impossible but standalone is not.
 *
 * Only iOS ends up here in practice. Used to offer Add to Home Screen instead of
 * a button that cannot work, since telling somebody the real route is better
 * than hiding the option and leaving them with the address bar.
 */
export function installInsteadOfFullscreen(): boolean {
  if (typeof document === 'undefined') return false;
  if (fullscreenAvailable()) return false;
  if (!window.matchMedia('(pointer: coarse)').matches) return false;
  // Already launched from the home screen: there is nothing left to suggest.
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  return !standalone;
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

    /*
     * Ask for landscape once we are in.
     *
     * The controls are laid out for two thumbs on the long edge, and a phone
     * that stays portrait in fullscreen gives a tall thin strip of world. The
     * lock is best-effort by design: it is unsupported in several browsers and
     * refused outright unless already fullscreen, and a refusal is not a reason
     * to fail the thing the player actually asked for.
     */
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (to: string) => Promise<void>;
    };
    if (window.matchMedia('(pointer: coarse)').matches && typeof orientation?.lock === 'function') {
      await orientation.lock('landscape').catch(() => undefined);
    }

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
