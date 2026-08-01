/**
 * The front door on the public web.
 *
 * sFace is a game about who crypto X was arguing about today, so an X account
 * is not decoration here: it is what makes a leaderboard a list of people
 * rather than a list of device ids, what lets a clan mean anything, and what
 * CT Signals reads. Asking for it before the main flow opens is honest about
 * that.
 *
 * ## Why the practice run is always there
 *
 * A hard wall is the obvious build and it is the wrong one. The first people
 * through this door are strangers, and a stranger who will not hand an
 * unfamiliar site their X account does not go away and think about it. They
 * close the tab, and the thing they never saw gets judged on the wall alone.
 *
 * So practice never runs out. It is a real, complete run on a level built from
 * a real chart, and it is the whole pitch delivered in ninety seconds with
 * nothing asked for first. What it does not do is persist: no score, no rank,
 * no Face, no clan, no Signals. That line is drawn before the run rather than
 * after, because a score confiscated at the end is a bait and switch.
 *
 * Three tiers, and each one is asked for only when it is actually needed:
 *
 *   practice   nothing. Fly today's chart, keep none of it.
 *   X          the daily mission, the campaign, rank, Face, clans, Signals.
 *   wallet     anything involving NIM. Nimiq Pay only, always.
 *
 * None of this exists inside Nimiq Pay. There the wallet is already the
 * identity and X is an upgrade offered on the home page, so gating would be
 * asking the same person to prove themselves twice.
 */

import { button, el, mount } from './dom';
import { walletCta } from './wallet-cta';

export interface GateOptions {
  /** Null when X connect is not configured on this deployment. */
  onConnectX: (() => void) | null;
  onPractice: () => void;
  notice: string | null;
}

export function renderGate(root: HTMLElement, options: GateOptions): void {
  mount(
    root,
    el(
      'div',
      { class: 'screen gate' },

      el('p', { class: 'eyebrow', text: 'CRYPTO IS DOWN' }),
      el('h1', { text: 'Somebody has to save face.' }),

      el('p', {
        class: 'gate__say',
        text: 'Every day the worst performer in the top 100 becomes the level. Its real chart is the ground you fly, and the people trapped in it are whoever crypto X was actually arguing about that day.',
      }),

      options.notice ? el('div', { class: 'notice notice--error', text: options.notice }) : null,

      /*
       * The ask, and immediately under it the reason. A sign-in button with no
       * sentence attached reads as a data grab; the same button with three
       * plain lines under it reads as a rule of the game, which is what it is.
       */
      options.onConnectX
        ? el(
            'div',
            { class: 'gate__act' },
            button('Sign in with X', options.onConnectX, 'x'),
            el(
              'ul',
              { class: 'gate__why' },
              el('li', { text: 'Your handle and picture fly on your character' }),
              el('li', { text: 'Scores, rank and Face are kept against your name' }),
              el('li', { text: 'Clans and CT Signals need to know who you are' }),
            ),
          )
        : el('p', {
            class: 'quiet',
            text: 'X sign-in is not configured on this build, so everything is open.',
          }),

      // Deliberately quiet, and deliberately permanent. It should read as a
      // way in for somebody who wants to see the thing first, not as the equal
      // option and not as a trial that is about to be taken away.
      button('Take a practice run', options.onPractice, 'quiet'),

      /*
       * What practice actually gives you, split honestly.
       *
       * Stage one is the whole game and it never runs out, because it is the
       * argument for signing in and a clipped argument is a weak one. The
       * later stages open too, on a clock, so a stranger SEES the cells and
       * the ash and the crowd rather than reading a promise about them.
       */
      el(
        'ul',
        { class: 'gate__practice' },
        el('li', { text: "Stage 1: today's real chart, the full run, as many times as you like" }),
        el('li', { text: 'Stages 2 to 7: open as tasters, so you can see what is up there' }),
        /*
         * Says what is waiting, not what is withheld.
         *
         * This line used to read "Nothing is saved either way: no score, no
         * rank, no Face", which is accurate and reads as a warning that playing
         * here is pointless. Same fact, pointed forwards: the rank exists, it
         * compounds, and it starts when you play properly.
         */
        el('li', { text: 'Face, rank, clans and challenges start the moment you play in Nimiq Pay' }),
      ),

      /*
       * The third tier, and the same panel a refused money path shows.
       *
       * Shared rather than written twice on purpose. This is the screen a
       * desktop judge meets first, so it is exactly where a dead nimiqpay://
       * link would do the most damage, and a second hand-rolled copy of the
       * QR is a second thing to forget to fix.
       *
       * Confirmed against nimiq.dev/mini-apps rather than assumed: the
       * deeplink opens the app when tapped ON A PHONE.
       */
      /*
       * The button and one line, nothing else.
       *
       * This carried a paragraph listing what is on the other side: Face, the
       * board, clans, staked challenges. All true, and all of it sitting
       * between somebody who has already decided to open the wallet and the
       * button that opens it. The pitch belongs on the front door, not stapled
       * to the door handle.
       */
      walletCta({
        note: 'Built as a Nimiq Pay Mini App. It opens in the app you already have.',
      }),

      // Just the mark. The privacy promises moved up next to the button that
      // actually asks for the account, which is where somebody deciding whether
      // to hand it over is looking.
      el('p', { class: 'gate__foot', text: 'sFace' }),
    ),
  );
}
