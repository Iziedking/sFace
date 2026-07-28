/**
 * The footer on the brief.
 *
 * Two jobs, and the second one is the real one.
 *
 * It fills the bottom of a page that had become mostly empty once the deck
 * stopped the brief from scrolling. That is the visible reason.
 *
 * The useful reason is that this is the only place in the product with room to
 * state the money model in plain sentences. Everywhere else it has to be a
 * chip or a line of small print, and "the app never holds funds" is the single
 * most important thing a stranger can know before they stake anything. A
 * footer is where people look for exactly that kind of statement, so it goes
 * where people look.
 *
 * Nothing here is a fabricated metric, a fake social proof row, or a newsletter
 * box. Those are what footers usually fill up with and all three would cost
 * more than the empty space did.
 */

import { el } from './dom';

export interface FooterOptions {
  onControls: () => void;
  onDispatch: () => void;
  onBoard: () => void;
  onCampaign: () => void;
  /**
   * The wallet's network, or null when there is no wallet attached.
   *
   * Null is a real third state and it must not be rendered as either of the
   * other two. Opened in a plain browser the footer used to say NIMIQ MAINNET,
   * which is asserting a fact nobody had: `isTestnet(null)` is false, and false
   * is not the same as mainnet. Claiming the live network to somebody about to
   * think about staking is the worst place in the product to guess.
   */
  network: string | null;
  testnet: boolean;
}

export function footer(options: FooterOptions): HTMLElement {
  return el(
    'footer',
    { class: 'foot' },

    el(
      'div',
      { class: 'foot__top' },

      el(
        'div',
        { class: 'foot__brand' },
        el(
          'div',
          { class: 'foot__mark' },
          el('span', { class: 'chrome__mark' }),
          el('span', { class: 'foot__word', text: 'sFace' }),
        ),
        el('p', {
          class: 'foot__say',
          /*
           * What sFace is, for somebody who arrived cold.
           *
           * The money model used to live here and it was the wrong thing for
           * the wrong place: a stranger scrolling to the bottom of a game they
           * have never played does not need the custody model, they need to
           * know what the game is. Trust statements belong next to the moment
           * money is actually at stake, which is the challenge screen.
           */
          text: 'Every day the worst performer in the top 100 becomes the level. Its real chart is the ground you fly, the fear index sets the odds, and the people trapped in it are whoever crypto was actually arguing about that day. Get them out, take back what Face you can carry, and come back tomorrow to a different day.',
        }),
      ),

      el(
        'div',
        { class: 'foot__links' },
        // One column, not two. A heading over a single link was a category
        // pretending to be a category.
        column('THE GAME', [
          ['How to play', options.onControls],
          ['The campaign', options.onCampaign],
          ['The Dispatch', options.onDispatch],
        ]),
        el(
          'div',
          { class: 'foot__col' },
          el('p', { class: 'foot__head', text: 'BUILT ON' }),
          link('Nimiq Pay Mini Apps', 'https://nimiq.dev/mini-apps/'),
          link('Nimiq', 'https://nimiq.com'),
        ),
      ),
    ),

    el(
      'div',
      { class: 'foot__rule' },
      el('span', { class: 'foot__note', text: 'THE MARKET BUILDS THE LEVEL' }),
      el('span', {
        class: 'foot__note',
        text:
          options.network === null
            ? 'OPEN IN NIMIQ PAY TO STAKE'
            : options.testnet
              ? 'NIMIQ TESTNET · STAKES ARE TEST NIM'
              : 'NIMIQ MAINNET',
      }),
    ),
  );
}

function column(head: string, rows: Array<[string, () => void]>): HTMLElement {
  return el(
    'div',
    { class: 'foot__col' },
    el('p', { class: 'foot__head', text: head }),
    ...rows.map(([label, onClick]) => {
      const node = el('button', { class: 'foot__link', type: 'button', text: label });
      node.addEventListener('click', onClick);
      return node;
    }),
  );
}

/** An outbound link. `noopener` because a new tab keeping a handle on ours is
 *  a needless hole, and `noreferrer` because they do not need to know. */
function link(label: string, href: string): HTMLElement {
  return el('a', {
    class: 'foot__link',
    href,
    target: '_blank',
    rel: 'noopener noreferrer',
    text: label,
  });
}
