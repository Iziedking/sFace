/**
 * How to play: what the game is, how it works, and what you are aiming at.
 *
 * It used to be a key map and nothing else, which answered the smallest of the
 * three questions somebody has when they open this. A player who knows W is
 * thrust and does not know that the ground is a real chart has learned the
 * least interesting thing on the screen.
 *
 * So the order is: what this is, then what you do, then how it pays, then the
 * keys. Anyone who only wanted the keys scrolls past three short blocks;
 * anyone who wanted to know why they should care gets told.
 *
 * Still off the critical path. Onboarding under sixty seconds is a judging
 * criterion and a tutorial nobody asked for is the usual way to lose it, so
 * this is one tap from the brief and never in front of anyone who did not ask.
 *
 * Controls shown are the ones the device in hand actually has, first. A phone
 * player being told about WASD learns nothing and concludes the game was not
 * built for them.
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

/** What the game is. Three sentences, no marketing. */
const PREMISE: Row[] = [
  {
    key: 'The ground is real',
    what: "Every day the worst performer in the top 100 becomes the level. Its actual 24 hour chart is the terrain you fly, pulled at midnight UTC.",
  },
  {
    key: 'So are the people',
    what: 'The five accounts in the wreck are the ones crypto X was genuinely arguing about today, read once a day and named on the brief.',
  },
  {
    key: 'The market sets the odds',
    what: 'The Fear and Greed index decides how crowded the sky is, and the chart’s own volatility decides where the attackers sit.',
  },
];

/** What you are actually trying to do. */
const AIM: Row[] = [
  {
    key: 'Get people out',
    what: 'Fly into someone to free them, then reach the extraction pad with them still behind you.',
  },
  {
    key: 'Take back Face',
    what: 'Face is the unit: reputation with a value still attached. Caches hold it, and it is what ranks you.',
  },
  {
    key: 'Clear the campaign',
    what: 'Seven stages, each restoring one piece of what 2026 cost. Clearing one opens the next.',
  },
  {
    key: 'Come back tomorrow',
    what: 'The stage stays. The level, the cast and the three contracts change every day with the market.',
  },
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
        el('p', { class: 'eyebrow', text: 'How to play' }),
        el('h1', { text: 'sFace' }),
        el('p', {
          class: 'quiet',
          text: 'A rescue shooter where the market builds the level. Crypto lost face in 2026. You go in and get it back.',
        }),
        block('What this is', PREMISE),
        block('What you are aiming at', AIM),
      ),
      el(
        'div',
        { class: 'col' },
        block('What pays', RULES),
        block(touchFirst() ? 'On a phone' : 'On a keyboard', first),
        block(touchFirst() ? 'On a keyboard' : 'On a phone', second),
        el('p', {
          class: 'quiet',
          text: 'Everyone flies the identical level, and the guns trade rather than upgrade, so staking NIM on a score is a fair bet rather than a gamble.',
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
