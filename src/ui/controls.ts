/**
 * How to play, on demand.
 *
 * Kept off the critical path deliberately. Onboarding under sixty seconds is a
 * judging criterion, and a tutorial nobody asked for is the usual way to lose
 * it, so this is one tap away from both the intro and the brief and never in
 * front of anyone who did not ask.
 *
 * It shows the controls that are actually available on the device in hand. A
 * phone player being told about WASD learns nothing and concludes the game was
 * not built for them.
 */

import { button, el, mount } from './dom';

export interface ControlsOptions {
  onBack: () => void;
}

/**
 * Coarse pointer means a finger. Not a perfect signal, and it does not need to
 * be: both sets are shown regardless, this only decides which comes first.
 */
function touchFirst(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
}

interface Row {
  key: string;
  what: string;
}

const TOUCH: Row[] = [
  { key: 'Left thumb', what: 'Anywhere on the left half. Drag to fly.' },
  { key: 'Right thumb', what: 'Anywhere on the right half. Drag to aim, and it fires while held.' },
  { key: 'Pause', what: 'The button at the top, clear of both thumbs.' },
  { key: 'Fly into someone', what: 'Frees them. They follow you out.' },
];

const DESKTOP: Row[] = [
  { key: 'W A S D', what: 'Fly. Arrow keys work too.' },
  { key: 'Mouse', what: 'Aim. No need to hold a button.' },
  { key: 'Click or Space', what: 'Fire.' },
  { key: 'Esc', what: 'Pause, and resume again. There is a button on screen too.' },
  { key: 'Fly into someone', what: 'Frees them. They follow you out.' },
];

const RULES: Row[] = [
  { key: 'Freeing someone', what: 'Pays a quarter of their Face straight away.' },
  { key: 'Reaching extraction', what: 'Pays the rest, for everyone still with you.' },
  { key: 'Going down', what: 'Loses everyone aboard. Caches you already took are safe.' },
  { key: 'Caches', what: 'Never on the easy line. The relic sits at the lowest point of the day.' },
];

export function renderControls(root: HTMLElement, options: ControlsOptions): void {
  const first = touchFirst() ? TOUCH : DESKTOP;
  const second = touchFirst() ? DESKTOP : TOUCH;

  mount(
    root,
    el(
      'div',
      { class: 'screen screen--split' },
      el(
        'div',
        { class: 'col' },
        el('p', { class: 'eyebrow', text: 'How to fly' }),
        el('h1', { text: 'Controls' }),
        block(touchFirst() ? 'On a phone' : 'On a keyboard', first),
        block(touchFirst() ? 'On a keyboard' : 'On a phone', second),
      ),
      el(
        'div',
        { class: 'col' },
        block('What pays', RULES),
        el('p', {
          class: 'quiet',
          text: 'A hundred and ten seconds. The chart is the ground. Everyone plays the same level with guns that trade rather than upgrade, so a challenge is a fair bet.',
        }),
        el('div', { class: 'actions' }, button('Got it', options.onBack)),
      ),
    ),
  );
}

function block(title: string, rows: Row[]): HTMLElement {
  return el(
    'div',
    {},
    el('p', { class: 'stat__label', text: title.toUpperCase() }),
    el(
      'div',
      { class: 'keys' },
      ...rows.map((r) =>
        el(
          'div',
          { class: 'keys__row' },
          el('span', { class: 'keys__key', text: r.key }),
          el('span', { class: 'keys__what', text: r.what }),
        ),
      ),
    ),
  );
}
