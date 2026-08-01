/**
 * The app bar.
 *
 * Every menu screen used to be a column floating in an empty cream field, which
 * reads as a phone app that has been stretched rather than as a page somebody
 * designed. A persistent bar fixes that in one move: it anchors the top edge,
 * it gives the content column something to sit under, and it puts the two
 * numbers a player checks constantly where they never have to go looking.
 *
 * Full bleed on purpose, while the content below it is a 1152px column. That
 * pairing is what makes a page feel built rather than centred: the frame owns
 * the whole width, the reading owns a measure.
 *
 * It lives outside #ui because screens mount by replacing #ui wholesale. A bar
 * inside that layer would be destroyed and rebuilt on every repaint, and the
 * repaints are frequent enough that it would visibly flicker.
 *
 * Hidden during a run, the loading screen and the intro. All three are single
 * focal points and a bar across the top of them is furniture in the way.
 */

import { network, networkLabel, setNetwork } from '../core/network';
import { el } from './dom';
import { rankFor } from '../data/story';
import type { DailyMission } from '../game/mission';
import type { Profile } from '../net/profile';
import { bell, bellPanel, type AppNotification } from './notifications';

export interface ChromeOptions {
  /** Null until the mission has landed, which is before any screen with a bar. */
  mission: DailyMission | null;
  profile: Profile | null;
  /** The clan tag, shown next to the tier so a member sees it everywhere. */
  clanTag: string | null;
  /**
   * The wordmark. Always live, and it goes to the opening rather than to the
   * brief: the brief is a mission, the intro is the front door, and a logo that
   * takes you anywhere other than the front door is a logo doing the wrong job.
   */
  onHome: () => void;
  /** The rank chip opens the ladder, which is the thing it is a number from. */
  onRank: () => void;

  /**
   * Things waiting on the player, and the panel's open state.
   *
   * Owned by the app rather than the bar, because the bar is rebuilt on every
   * repaint and a panel that closed itself whenever a screen changed would be
   * unusable on exactly the screens it sends you to.
   */
  notifications: AppNotification[];
  bellOpen: boolean;
  onToggleBell: () => void;
  onClearNotifications: () => void;
}

export function renderChrome(root: HTMLElement, options: ChromeOptions): void {
  root.hidden = false;

  const face = options.profile?.lifetimeFace ?? 0;
  const tier = rankFor(face).rank;

  const mark = el(
    'div',
    { class: 'chrome__brand' },
    el('span', { class: 'chrome__mark' }),
    el('span', { class: 'chrome__word', text: 'sFace' }),
  );

  mark.classList.add('chrome__brand--link');
  mark.setAttribute('role', 'button');
  mark.setAttribute('tabindex', '0');
  mark.setAttribute('aria-label', 'sFace, back to the opening');
  mark.addEventListener('click', options.onHome);
  mark.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      options.onHome();
    }
  });

  const mission = options.mission;

  // Today's wreck, always on screen. It is the premise of the whole game and it
  // changes daily, so it is worth the space it takes.
  const wreck = mission
    ? el(
        'div',
        { class: 'chrome__mission' },
        el('span', { class: 'chrome__ticker', text: mission.ticker }),
        /*
         * Nothing beside the ticker on a practice mission.
         *
         * A practice mission's ticker IS the word PRACTICE, so the old flat
         * chip printed it a second time and the bar read "PRACTICE PRACTICE".
         * The state is already stated; saying it twice is not clearer.
         */
        mission.live
          ? el('span', {
              class: 'chrome__change',
              text: `${mission.changePct.toFixed(1)}%`,
            })
          : null,
      )
    : null;

  const clan = options.clanTag
    ? el('span', { class: 'chrome__clan', text: options.clanTag })
    : null;

  /*
   * The rank chip.
   *
   * It used to collapse to a bare orange square with a number in it on a phone,
   * because the label beside it was hidden to save width. A "4" on its own
   * means nothing to anybody, which is exactly what a player asked. So the
   * number keeps its Face total at every width, the whole chip is a button
   * that opens the ladder it refers to, and it carries a label for anyone who
   * cannot see the layout at all.
   */
  const rank = el(
    'button',
    {
      class: 'chrome__rank',
      type: 'button',
      'aria-label': `Rank ${tier.tier}, ${tier.name}, ${face.toLocaleString()} Face. Open the ladder.`,
    },
    el('span', { class: 'chrome__tier', text: String(tier.tier) }),
    el(
      'div',
      { class: 'chrome__rankbody' },
      el('span', { class: 'chrome__rankname', text: tier.name }),
      el('span', { class: 'chrome__face', text: `${face.toLocaleString()} Face` }),
    ),
  );
  rank.addEventListener('click', options.onRank);

  /*
   * Which chain this is, top right, always.
   *
   * Permanent rather than tucked into settings, because it answers a question
   * that changes what every number on screen MEANS. A stake of five NIM is a
   * real five NIM or it is nothing at all, and a player who cannot tell at a
   * glance which one they are looking at has been handed a trap.
   *
   * It is a switch as well as a label. Two networks are the entire set, so a
   * menu would be a click to reveal one alternative; tapping cycles instead.
   */
  const net = network();
  const chain = el(
    'button',
    {
      class: net === 'test' ? 'chrome__net chrome__net--test' : 'chrome__net',
      type: 'button',
      'aria-label': `Network: ${networkLabel(net)}. Switch to ${networkLabel(
        net === 'test' ? 'main' : 'test',
      )}.`,
      title:
        net === 'test'
          ? 'Testnet: nothing here is worth anything, live reads are off, and Face counts on its own board. Tap for mainnet.'
          : 'Mainnet: real NIM, real board. Tap to rehearse on testnet.',
    },
    el('span', { class: 'chrome__netdot' }),
    /*
     * Shortened rather than hidden on a narrow screen.
     *
     * MAINNET and TESTNET do not fit beside a wordmark, a ticker and a rank chip
     * on a phone, and the old answer was to drop the word entirely and keep a
     * coloured dot. That made it unreadable: this chip decides whether the NIM
     * on screen is real, and nobody should have to learn a colour code for that.
     * MAIN and TEST fit, and say it.
     */
    el('span', {
      class: 'chrome__netname',
      text: net === 'test' ? 'TEST' : 'MAIN',
    }),
  );
  chain.addEventListener('click', () => setNetwork(net === 'test' ? 'main' : 'test'));

  const bellOptions = {
    items: options.notifications,
    open: options.bellOpen,
    onToggle: options.onToggleBell,
    onClearAll: options.onClearNotifications,
  };

  root.replaceChildren(
    ...[
      mark,
      wreck,
      el('div', { class: 'chrome__spacer' }),
      clan,
      chain,
      bell(bellOptions),
      rank,
    ].filter((node): node is HTMLElement => node !== null),
  );

  /*
   * The panel is fixed and mounted outside the bar.
   *
   * Inside it, the bar's own overflow and stacking would clip a 320px panel
   * hanging off a 38px button. Pinned to the document instead, positioned
   * under the bell in CSS.
   */
  document.querySelector('.bellpanel')?.remove();
  const panel = bellPanel(bellOptions);
  if (panel) document.body.appendChild(panel);
}

export function hideChrome(root: HTMLElement): void {
  root.hidden = true;
  root.replaceChildren();
  // The panel lives on the body, so hiding the bar would otherwise leave it
  // floating over a run with no bell to close it.
  document.querySelector('.bellpanel')?.remove();
}
