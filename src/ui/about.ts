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
 * The three things that make NIM Atlas a game rather than a lesson with a
 * crypto label.
 *
 * Each one is a fact about how the game is built, not a claim about how good it
 * is. A stranger can check every one of them inside a single run.
 */
const PILLARS: Panel[] = [
  {
    kicker: 'The city',
    title: 'Every route has a reason',
    body: 'Beacon Commons is a living city with people, places, and payment routes that can go dark. You follow the marker, meet the resident who needs help, and change the city by solving the problem.',
  },
  {
    kicker: 'The lesson',
    title: 'You learn by doing',
    body: 'NIM, Lunas, wallet approval, and confirmation are tools in the adventure. Inspect the request, compare the evidence, choose the safe action, and see the harbor respond.',
  },
  {
    kicker: 'The return loop',
    title: 'There is always another route',
    body: 'Finish Mara’s Last Lantern, try the Daily Atlas, open the next district, and revisit the Living Knowledge Book. Practice is free, and the city keeps giving you a reason to come back.',
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
    kicker: 'The chain',
    title: 'NIM is the lesson',
    body: 'NIM is Nimiq’s currency. Lunas are its smallest units: 1 NIM equals 100,000 Lunas. The game introduces that difference exactly where the payment request needs it.',
  },
  {
    kicker: 'The wallet',
    title: 'Approval is a real choice',
    body: 'Practice mode needs no wallet and never sends NIM. When the TestAlbatross path is enabled, the game shows the exact request first and waits for canonical confirmation before the route opens.',
  },
  {
    kicker: 'The proof',
    title: 'The city changes on evidence',
    body: 'A button press, callback, or transaction hash is not enough. The route unlocks only when the network, recipient, amount, success state, and confirmations match.',
  },
  {
    kicker: 'The world',
    title: 'A payment becomes a place',
    body: 'When the route is repaired, Mara’s harbor responds. Lights return, paths open, and the next part of the city becomes available. The technology is part of the adventure, not a paragraph beside it.',
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

      el('p', { class: 'eyebrow', text: 'NIM ATLAS / BEACON COMMONS' }),
      el('h1', { text: 'Repair the route. Bring the city back.' }),

      /*
       * The whole idea, once, at the top.
       *
       * Somebody who reads only this line and then presses play has understood
       * enough to enjoy the game. Everything below adds context without making
       * the player study before moving.
       */
      el('p', {
        class: 'doc__lede',
        text: 'Sface is a Nimiq Pay Mini App game. NIM Atlas is the adventure inside it: a living city where broken payment routes strand real people. Choose Explorer or Builder, follow Mara’s route, and learn how Nimiq works by making the right decision at the right place.',
      }),

      el(
        'div',
        { class: 'doc__actions' },
        button('Play today', options.onPlay),
        button('How to play', options.onGuide, 'ghost'),
      ),

      el('h2', { class: 'doc__section', text: 'What you do in the city' }),
      panels(PILLARS, 'doc__grid doc__grid--three'),

      el('h2', { class: 'doc__section', text: 'Why Nimiq matters' }),
      el('p', {
        class: 'doc__body doc__body--wide',
        text: 'Nimiq is not decoration around the game. Its payment concepts are the actions that move the story forward.',
      }),
      panels(NIMIQ, 'doc__grid doc__grid--two'),

      el('h2', { class: 'doc__section', text: 'A run, end to end' }),
      el(
        'ol',
        { class: 'doc__steps' },
        el('li', {
          text: 'Open sFace in Nimiq Pay. Practice mode starts immediately, with no wallet required.',
        }),
        el('li', {
          text: 'Enter Beacon Commons and follow the route marker to Mara at Pay Harbor.',
        }),
        el('li', {
          text: 'Inspect the request. Check the network, recipient, and amount in Lunas.',
        }),
        el('li', {
          text: 'Choose the safe action, learn why it is correct, and watch the harbor respond.',
        }),
        el('li', {
          text: 'Return for the Daily Atlas, the next district, and the Living Knowledge Book.',
        }),
      ),

      el('h2', { class: 'doc__section', text: 'MAIN and TEST' }),
      el('p', {
        class: 'doc__body doc__body--wide',
        text: 'The game separates practice from live payment play. The network label tells you which path is active before any approval can be requested.',
      }),
      panels(
        [
          {
            kicker: 'PRACTICE',
            title: 'Start without a wallet',
            body: 'Local, free, and safe for first-time players. The practice lantern uses a committed fixture and never sends NIM.',
          },
          {
            kicker: 'TESTALBATROSS',
            title: 'A real payment lesson',
            body: 'When enabled by the owner, the game shows an exact 0.1 NIM request, opens Nimiq Pay for approval, and waits for server-confirmed evidence before restoring the route.',
          },
        ],
        'doc__grid doc__grid--two',
      ),

      el(
        'div',
        { class: 'doc__note' },
        el('p', {
          class: 'doc__body',
          text: 'Start with Mara’s Last Lantern. The story gets bigger as each repaired route restores another piece of the city.',
        }),
      ),

      el('div', { class: 'actions' }, button('Back', options.onBack, 'ghost')),
    ),
  );
}
