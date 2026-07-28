/**
 * A deck of panels that turns itself over.
 *
 * ## The problem
 *
 * The brief grew. It started as a mission card and a start button, and by the
 * time it carried the day's story, the stage, three contracts, five people in
 * the wreck and the connected account, it was a screen you scrolled to
 * understand. That is the wrong shape for the first thing anybody sees: a
 * player should not have to discover that the game has contracts by scrolling
 * past the fold to find them.
 *
 * So the categories take turns in one fixed frame. Nothing is hidden, nothing
 * needs scrolling, and the app explains itself while you look at it.
 *
 * ## Auto-advancing content is an accessibility problem unless it is handled
 *
 * A carousel that moves on its own and cannot be stopped is one of the more
 * reliable ways to make a page unusable, so this does all four of the things
 * that make it acceptable:
 *
 *   - It stops permanently the first time you touch it. Not pauses: stops. If
 *     you have taken control, taking it back off you is the actual complaint
 *     people have about carousels.
 *   - It pauses while hovered or focused, so reading is never interrupted.
 *   - Every panel is reachable directly from the dots, and the dots are real
 *     buttons in the tab order with labels.
 *   - Under prefers-reduced-motion it does not animate and does not advance at
 *     all; the dots still work.
 *
 * The panels are also all in the DOM at once and hidden with `hidden`, rather
 * than being built and destroyed, so nothing inside them loses state when the
 * deck turns and a screen reader can find all of it.
 */

import { el } from './dom';

export interface DeckPanel {
  /** Short, uppercase, shown on the tab. */
  label: string;
  body: HTMLElement;
}

export interface DeckOptions {
  panels: DeckPanel[];
  /** Milliseconds each panel holds. */
  interval?: number;
}

const DEFAULT_INTERVAL = 4200;

function reducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Build the deck. Returns the element and a stop function.
 *
 * The caller must call `stop` when the screen is torn down, or the timer
 * outlives the DOM it was written for and keeps firing against detached nodes.
 * Every screen here is replaced wholesale on navigation, so this is not
 * theoretical.
 */
export function deck(options: DeckOptions): { root: HTMLElement; stop: () => void } {
  const panels = options.panels.filter((p) => p.body.childNodes.length > 0 || p.label.length > 0);
  const quiet = reducedMotion();

  let index = 0;
  let timer: number | null = null;
  /** Set once the player has taken control. The deck never auto-advances again. */
  let taken = false;

  const bodies = panels.map((panel) => {
    const holder = el('div', { class: 'deck__panel' }, panel.body);
    return holder;
  });

  const tabs = panels.map((panel, at) => {
    const tab = el('button', {
      class: 'deck__tab',
      type: 'button',
      text: panel.label,
      'aria-label': `Show ${panel.label}`,
    });
    tab.addEventListener('click', () => {
      taken = true;
      halt();
      show(at);
    });
    return tab;
  });

  const stage = el('div', { class: 'deck__stage' }, ...bodies);
  const rail = el('div', { class: 'deck__rail' }, ...tabs);
  const root = el('div', { class: 'deck' }, rail, stage);

  function show(next: number): void {
    index = ((next % panels.length) + panels.length) % panels.length;

    bodies.forEach((body, at) => {
      body.hidden = at !== index;
      if (at === index && !quiet) {
        // Retrigger the entrance by swapping the class across a frame. Without
        // the reflow the browser coalesces the removal and the addition and
        // nothing animates at all.
        body.classList.remove('is-in');
        void body.offsetWidth;
        body.classList.add('is-in');
      }
    });

    tabs.forEach((tab, at) => {
      tab.classList.toggle('is-on', at === index);
      tab.setAttribute('aria-current', at === index ? 'true' : 'false');
    });
  }

  function halt(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  function start(): void {
    if (quiet || taken || panels.length < 2) return;
    halt();
    timer = window.setInterval(() => show(index + 1), options.interval ?? DEFAULT_INTERVAL);
  }

  // Reading must never be interrupted, so hovering or focusing anything inside
  // holds the current panel until the pointer leaves.
  root.addEventListener('pointerenter', halt);
  root.addEventListener('pointerleave', () => start());
  root.addEventListener('focusin', halt);
  root.addEventListener('focusout', () => start());

  show(0);
  start();

  return { root, stop: halt };
}
