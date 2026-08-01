/**
 * What sFace is, for somebody who has never seen it.
 *
 * Written to be understood in about a minute. It opens with the whole idea in
 * one sentence, then answers the three questions a stranger actually has, in the
 * order they have them: what am I looking at, why does it involve a wallet, and
 * what happens when I press start.
 *
 * Deliberately short. The game explains itself once it is running, so this page
 * exists to get someone to that point rather than to describe it in advance.
 */

import { el, mount, button } from './dom';

export interface AboutOptions {
  onBack: () => void;
  onPlay: () => void;
  onGuide: () => void;
}

interface Panel {
  kicker: string;
  title: string;
  body: string;
}

/**
 * The three things that make this different from a shooter with a crypto skin.
 *
 * Each one is a fact about how the game is built, not a claim about how good it
 * is. A stranger can check every one of them inside a single run.
 */
const PILLARS: Panel[] = [
  {
    kicker: 'The map',
    title: 'Nobody drew this',
    body: 'Today’s worst performer in the top hundred becomes the stage. Its real 24 hour chart is the ground under you. A violent morning is a wall you have to climb. A slow bleed is a long drop with nowhere to stand.',
  },
  {
    kicker: 'The odds',
    title: 'The market sets the difficulty',
    body: 'Fear and Greed decides how many come at you and how fast they fire. Calm day, generous level. Frightened day, considerably less so. Everyone who plays that day gets the same one.',
  },
  {
    kicker: 'The people',
    title: 'The cast is real',
    body: 'The accounts trapped in the wreck are whoever crypto X spent the day on, read fresh every morning. Every post you see went out for real, and every one carries a link back to it.',
  },
];

/**
 * Why this belongs on Nimiq specifically.
 *
 * Each point is a property of the chain or of Mini Apps that the game actually
 * depends on. Nothing here is true of "any L1", which is the test a claim like
 * this has to pass to be worth printing.
 */
const NIMIQ: Panel[] = [
  {
    kicker: 'Built for it',
    title: 'Made for Nimiq Pay',
    body: 'sFace opens inside the app you already have. Your wallet, your name and your clan are waiting before you press start. Nothing to download. No extension. No seed phrase halfway through a run.',
  },
  {
    kicker: 'Play for something',
    title: 'Every run banks Face',
    body: 'Face is your rank. Rank opens stages, weapons and a steadier gun. It carries across days, so whoever shows up every morning pulls away from whoever does not.',
  },
  {
    kicker: 'Bring people',
    title: 'Clans, challenges, contests',
    body: 'Build a clan and climb together. Put NIM on a friend and the same seed, then let the better run take it. Win the day and the board carries your handle. All of it settles in seconds for a fee you will never notice.',
  },
  {
    kicker: 'Yours throughout',
    title: 'Signed by you, checked by us',
    body: 'Your wallet signs the score. We rebuild the level from the seed and check the run could have happened. We never hold your money, and we never take your word for it.',
  },
];

export function renderAbout(root: HTMLElement, options: AboutOptions): void {
  root.className = '';

  const panels = (items: Panel[], className: string): HTMLElement =>
    el(
      'div',
      { class: className },
      ...items.map((panel) =>
        el(
          'article',
          { class: 'doc__card' },
          el('p', { class: 'doc__kicker', text: panel.kicker.toUpperCase() }),
          el('h3', { class: 'doc__cardtitle', text: panel.title }),
          el('p', { class: 'doc__body', text: panel.body }),
        ),
      ),
    );

  mount(
    root,
    el(
      'div',
      { class: 'screen doc' },

      el('p', { class: 'eyebrow', text: 'What this is' }),
      el('h1', { text: 'The market builds the level.' }),

      /*
       * The whole idea, once, at the top.
       *
       * Somebody who reads only this line and then presses play has understood
       * enough to enjoy the game. Everything below is for the ones who want to
       * know why before they start.
       */
      el('p', {
        class: 'doc__lede',
        text: 'Crypto has had a rough year. Every week another chart falls apart and another set of people get written off. sFace turns that day into something you can play. Get the people out of the wreck, carry back what you can, and come back tomorrow when it is a different coin and a different crowd.',
      }),

      el(
        'div',
        { class: 'doc__actions' },
        button('Play today', options.onPlay),
        button('How to play', options.onGuide, 'ghost'),
      ),

      el('h2', { class: 'doc__section', text: 'What you are actually flying' }),
      panels(PILLARS, 'doc__grid doc__grid--three'),

      el('h2', { class: 'doc__section', text: 'It lives on Nimiq' }),
      el('p', {
        class: 'doc__body doc__body--wide',
        text: 'Your wallet is your name here. It holds your rank, backs your stake and signs every score you post.',
      }),
      panels(NIMIQ, 'doc__grid doc__grid--two'),

      el('h2', { class: 'doc__section', text: 'A run, end to end' }),
      el(
        'ol',
        { class: 'doc__steps' },
        el('li', {
          text: 'Open sFace in Nimiq Pay. Today’s coin, its chart and its cast are already loaded.',
        }),
        el('li', {
          text: 'Fly the wreck and free the people caught in it. Reach the pad, or you lose everything you were carrying.',
        }),
        el('li', {
          text: 'Bank your Face. Rank opens the next stage, the next weapon and a steadier gun.',
        }),
        el('li', {
          text: 'Join a clan, stake a friend on your exact seed, and put your handle on the daily board.',
        }),
        el('li', {
          text: 'Come back tomorrow for a new coin, a new chart and a new cast. Your rank carries over.',
        }),
      ),

      el('h2', { class: 'doc__section', text: 'MAIN and TEST' }),
      el('p', {
        class: 'doc__body doc__body--wide',
        text: 'The chip in the top right shows which network you are on. It changes what the NIM on screen is worth, so it is always visible and you can tap it to switch.',
      }),
      panels(
        [
          {
            kicker: 'MAIN',
            title: 'Mainnet, the real thing',
            body: 'Real NIM. Your scores go to the daily board, challenges settle for real money, and CT Signals reads live X. This is the default.',
          },
          {
            kicker: 'TEST',
            title: 'Testnet, a rehearsal',
            body: 'The same game played for nothing, on data already cached. You are still you here, with the same name, clan and friends. NIM has no value, testnet keeps its own board and its own Face, and anything that needs a live API call is off. Use it to try a staked challenge without spending anything. Settings links the Nimiq faucet.',
          },
        ],
        'doc__grid doc__grid--two',
      ),

      el(
        'div',
        { class: 'doc__note' },
        el('p', {
          class: 'doc__body',
          text: 'Seven stages, and the last one is what the rest builds toward. Getting the season back means going through everything that broke it.',
        }),
      ),

      el('div', { class: 'actions' }, button('Back', options.onBack, 'ghost')),
    ),
  );
}
