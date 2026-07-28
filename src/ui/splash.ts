/**
 * The splash: three seconds of brand between the opening tap and the game.
 *
 * ## Why a deliberate wait is not a wasted one
 *
 * Every instinct says a loading screen should be as short as physically
 * possible, and for a spinner that is right. This is not a spinner. It is the
 * one moment the product gets to be a poster rather than a page, and three
 * seconds of a mark landing, a chart drawing and a tagline arriving is what
 * makes somebody feel they opened something built rather than something
 * generated.
 *
 * The cost is real and bounded: it happens once per session on the way in, and
 * the short form used between screens is a second and a half. Both are held to
 * a hard ceiling so a slow network can never make them longer.
 *
 * ## It is a floor, not a delay
 *
 * The work behind it runs concurrently. `hold` resolves when BOTH the real
 * work and the minimum time are done, so a cold fetch that takes four seconds
 * shows the splash for four seconds and a warm one still shows it for three.
 * Nothing waits on the animation that was not already waiting on the network.
 *
 * The one thing it must never do is outlast its own animation, which is the
 * mistake the boot chart made: a picture still drawing when the screen is
 * replaced reads as broken. Everything here finishes inside 2.2 seconds.
 */

import { el, mount } from './dom';

/** The full entrance, once per session, after the opening tap. */
export const SPLASH_FULL_MS = 3000;
/** Between screens and on a reload. Long enough to register, short enough to forgive. */
export const SPLASH_SHORT_MS = 1500;

/**
 * The mark, drawn rather than typed.
 *
 * An inline SVG so it can be animated stroke by stroke and still be one file
 * with no request. It is the same shape as the favicon and the loading art:
 * the orange square, the wordmark, and the chart line that is the whole
 * premise of the game.
 *
 * The line descends, with two rallies that fail. It drew upward in the first
 * version, which is a cheerful little logo for a game about the worst
 * performer in the top 100 and says the opposite of everything else here.
 *
 * Author-written literal, which is the only reason innerHTML appears here. See
 * the identical note in ui/loading.ts.
 */
const MARK = `
<svg viewBox="0 0 320 150" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
  <rect class="splash__square" x="18" y="26" width="30" height="30" fill="#ff5a1f" stroke="#14110e" stroke-width="4"/>
  <path class="splash__chart"
    d="M18 58 L60 78 L96 68 L134 96 L172 86 L210 110 L248 102 L302 126"
    pathLength="1" fill="none" stroke="#ff5a1f" stroke-width="7"
    stroke-linecap="round" stroke-linejoin="round"/>
  <path class="splash__chart splash__chart--keel"
    d="M18 58 L60 78 L96 68 L134 96 L172 86 L210 110 L248 102 L302 126"
    pathLength="1" fill="none" stroke="#14110e" stroke-width="3"
    stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

export interface SplashOptions {
  /** Shown under the mark. Defaults to the tagline. */
  line?: string;
  /** Short form for a transition, full form for the entrance. */
  short?: boolean;
}

export function renderSplash(root: HTMLElement, options: SplashOptions = {}): void {
  const art = el('div', { class: 'splash__art' });
  art.innerHTML = MARK;

  mount(
    root,
    el(
      'div',
      {
        class: options.short
          ? 'screen screen--center screen--bare splash splash--short'
          : 'screen screen--center screen--bare splash',
      },
      el(
        'div',
        { class: 'splash__stack' },
        art,
        el('h1', { class: 'splash__word', text: 'sFace' }),
        el('p', { class: 'splash__line', text: options.line ?? 'Somebody has to save face' }),
      ),
    ),
  );
}

/**
 * Run `work` behind a splash and return whatever it returned.
 *
 * The splash is a floor on the elapsed time, not an addition to it. Failure is
 * passed straight through: a splash that swallowed an error would leave the
 * caller with no result and no reason.
 */
export async function hold<T>(
  root: HTMLElement,
  work: Promise<T>,
  options: SplashOptions = {},
): Promise<T> {
  renderSplash(root, options);

  const floor = options.short ? SPLASH_SHORT_MS : SPLASH_FULL_MS;
  const [result] = await Promise.all([
    work,
    new Promise((resolve) => setTimeout(resolve, floor)),
  ]);

  return result;
}

/** A splash with nothing behind it, for a transition between two screens. */
export function pause(root: HTMLElement, options: SplashOptions = {}): Promise<void> {
  return hold(root, Promise.resolve(), { short: true, ...options });
}
