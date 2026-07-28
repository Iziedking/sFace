/**
 * Pause, and the one control that lives on top of a run.
 *
 * A ninety second run does not obviously need a pause, right up until the
 * moment somebody gets a phone call twenty seconds into their best one. It
 * costs almost nothing and its absence is the kind of thing people remember.
 *
 * The overlay does not stop the loop, only the simulation step, so the chart
 * keeps drawing behind it and resuming has nothing to restart.
 */

import { button, el, mount } from './dom';

export interface PauseOptions {
  onResume: () => void;
  onQuit: () => void;
}

export function renderPause(root: HTMLElement, options: PauseOptions): void {
  // Back to a solid sheet: a paused game should read as stopped, not as a
  // game you are still meant to be looking through.
  root.className = '';

  mount(
    root,
    el(
      'div',
      { class: 'screen screen--center screen--bare screen--narrow' },
      el('p', { class: 'eyebrow', text: 'Holding' }),
      el('h1', { text: 'Paused' }),
      el(
        'div',
        { class: 'actions' },
        button('Resume', options.onResume),
        button('Give up the run', options.onQuit, 'ghost'),
      ),
      // No key hint here. The controls screen is where controls are explained,
      // and a paused game does not need to teach anything.
    ),
  );
}

export interface RunOverlayOptions {
  onPause: () => void;
}

/**
 * The only thing drawn over a live run.
 *
 * Deliberately one small control in a corner. Every pixel here competes with
 * the game for attention, and a phone player's thumbs are already busy on both
 * halves of the screen, so it sits top-centre under the HUD strip where
 * neither thumb rests.
 */
export function renderRunOverlay(root: HTMLElement, options: RunOverlayOptions): void {
  const pause = el('button', {
    class: 'pausebtn',
    type: 'button',
    'aria-label': 'Pause',
    text: '❙❙',
  });
  pause.addEventListener('click', options.onPause);

  mount(root, el('div', { class: 'hud-overlay' }, pause));
}
