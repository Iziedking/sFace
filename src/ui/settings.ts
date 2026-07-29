/**
 * Settings. Currently one decision, which is the point.
 *
 * A settings screen is where features go to hide, so this holds only things a
 * player genuinely needs to change about how the game responds to them, and
 * nothing that is really a preference we were too undecided to make.
 *
 * Sound and fullscreen stay on the brief where they already are: those are
 * one-tap toggles you reach for mid-session, and burying them a level deeper
 * to tidy the home page would be a worse app arranged more neatly.
 */

import { button, el, mount } from './dom';
import {
  SCHEME_LABEL,
  SCHEME_SAY,
  scheme,
  setScheme,
  touchCapable,
  type Scheme,
} from '../core/scheme';

export interface SettingsOptions {
  onBack: () => void;
  /** Re-render, so the chosen row updates under the thumb that chose it. */
  onChange: () => void;
}

const ORDER: Scheme[] = ['touch', 'analog', 'dpad'];

export function renderSettings(root: HTMLElement, options: SettingsOptions): void {
  const active = scheme();

  mount(
    root,
    el(
      'div',
      { class: 'screen settings' },

      el('p', { class: 'eyebrow', text: 'Settings' }),
      el('h1', { text: 'How you fly' }),
      el('p', {
        class: 'guide__lead',
        text: 'Both schemes are always available on a phone. This only decides which one is listening.',
      }),

      /*
       * Said plainly rather than hiding the rows.
       *
       * Hiding them on a desktop would leave somebody who set pads on their
       * phone unable to find the setting they know exists, and would make the
       * screen look like it had lost something. The choice is still saved and
       * still applies the moment they pick the phone back up.
       */
      !touchCapable()
        ? el('div', {
            class: 'notice',
            text: 'You are on a keyboard, so the pads stay off and WASD flies. Pick one anyway and it will be waiting on your phone.',
          })
        : null,

      el(
        'div',
        { class: 'schemes' },
        ...ORDER.map((id) => schemeRow(id, id === active, options)),
      ),

      /*
       * The landscape note.
       *
       * Not enforced. Locking orientation in a WebView is unreliable and
       * fighting the player's rotation lock is worse than a sentence. The game
       * is playable in portrait and better in landscape, so say that and let
       * them decide.
       */
      el('p', {
        class: 'settings__note',
        text: 'Turn the phone sideways if you can. The level runs left to right, so landscape shows you more of what is coming and puts both controls under your thumbs.',
      }),

      el('div', { class: 'actions' }, button('Done', options.onBack)),
    ),
  );
}

function schemeRow(id: Scheme, active: boolean, options: SettingsOptions): HTMLElement {
  const node = el(
    'button',
    {
      class: active ? 'scheme scheme--on' : 'scheme',
      type: 'button',
      // Announced as a choice within a set, not as three unrelated buttons.
      role: 'radio',
      'aria-checked': active ? 'true' : 'false',
    },
    el(
      'div',
      { class: 'scheme__body' },
      el('p', { class: 'scheme__name', text: SCHEME_LABEL[id] }),
      el('p', { class: 'scheme__say', text: SCHEME_SAY[id] }),
    ),
    el('span', { class: 'scheme__mark', text: active ? 'ON' : '' }),
  );

  node.addEventListener('click', () => {
    setScheme(id);
    options.onChange();
  });

  return node;
}
