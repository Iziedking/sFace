/**
 * What a preview run ends on.
 *
 * sFace is a Nimiq Pay Mini App. A browser tab can show somebody what the game
 * is, and it should, because seeing today's real chart with real people trapped
 * in it is what makes anyone want to play properly. What a tab cannot be is the
 * whole game: rank that compounds, a clan, a challenge that settles, a place on
 * the board. Those live in the wallet, and if a tab could reach them the wallet
 * becomes a payment step people route around rather than where the game is.
 *
 * So this screen deliberately withholds the score. Not as a punishment, and not
 * to nag: a number would settle the question, and the point is to leave it open.
 * What it shows instead is what the run WOULD have been worth and what is on the
 * other side of opening it in Nimiq Pay.
 */

import { button, el, mount } from './dom';
import { walletCta } from './wallet-cta';
import type { RunState } from '../game/state';

export interface HandoffOptions {
  state: RunState;
  onReplay: () => void;
  onHome: () => void;
}

/** What the wallet has that a tab does not. Concrete, not adjectives. */
const WAITING: Array<[string, string]> = [
  ['Face that builds up', 'Every run banks rank. Rank opens stages, weapons and a steadier gun.'],
  ['The daily board', 'Your handle against everyone who flew the same chart today.'],
  ['Clans', 'Climb with people. The clan table is a contest of its own.'],
  ['Challenges', 'Put NIM on a friend and the same seed. The better run takes it.'],
];

export function renderHandoff(root: HTMLElement, options: HandoffOptions): void {
  const { state } = options;
  root.className = '';

  const freed = state.facesExtracted;
  const carried = state.carrying;

  mount(
    root,
    el(
      'div',
      { class: 'screen screen--narrow handoff' },

      el('p', { class: 'eyebrow', text: 'Preview over' }),
      el('h1', { text: 'That was twenty five seconds of it.' }),

      /*
       * Say what they actually did, without scoring it.
       *
       * A run that reports nothing feels like it was taken away. A run that
       * reports a number is finished. This reports the ACT and leaves the value
       * of it on the other side of the door.
       */
      el('p', {
        class: 'handoff__lead',
        text:
          freed > 0 || carried > 0
            ? `You got to ${freed + carried} of them on ${state.mission.ticker}. In Nimiq Pay a run like that banks Face, and Face is rank.`
            : `That was ${state.mission.ticker} at its worst today. In Nimiq Pay you get the whole clock to work it.`,
      }),

      el(
        'ul',
        { class: 'handoff__list' },
        ...WAITING.map(([title, what]) =>
          el(
            'li',
            {},
            el('span', { class: 'handoff__title', text: title }),
            el('span', { class: 'handoff__what', text: what }),
          ),
        ),
      ),

      /*
       * The existing wallet call to action, not a second one.
       *
       * It already carries the deep link, the QR fallback for somebody on a
       * laptop, and the store links for a person who has no wallet yet. Building
       * a rival version here would mean two components drifting apart on the one
       * screen where getting into Nimiq Pay matters most.
       */
      walletCta({
        head: 'THE FULL RUN',
        reason: 'The full clock, the board, clans and challenges are all in Nimiq Pay.',
      }),

      el(
        'div',
        { class: 'actions' },
        button('Watch it again', options.onReplay, 'ghost'),
        button('Back', options.onHome, 'ghost'),
      ),

      el('p', {
        class: 'handoff__foot',
        text: 'New coin, new chart, new cast every day. The ladder remembers all of it.',
      }),
    ),
  );
}
