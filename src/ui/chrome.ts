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

import { el } from './dom';
import { rankFor } from '../data/story';
import type { DailyMission } from '../game/mission';
import type { Profile } from '../net/profile';

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
        mission.live
          ? el('span', {
              class: 'chrome__change',
              text: `${mission.changePct.toFixed(1)}%`,
            })
          : el('span', { class: 'chrome__change chrome__change--flat', text: 'PRACTICE' }),
      )
    : null;

  const clan = options.clanTag
    ? el('span', { class: 'chrome__clan', text: options.clanTag })
    : null;

  const rank = el(
    'div',
    { class: 'chrome__rank' },
    el('span', { class: 'chrome__tier', text: String(tier.tier) }),
    el(
      'div',
      { class: 'chrome__rankbody' },
      el('span', { class: 'chrome__rankname', text: tier.name }),
      el('span', { class: 'chrome__face', text: `${face.toLocaleString()} Face` }),
    ),
  );

  root.replaceChildren(
    ...[mark, wreck, el('div', { class: 'chrome__spacer' }), clan, rank].filter(
      (node): node is HTMLElement => node !== null,
    ),
  );
}

export function hideChrome(root: HTMLElement): void {
  root.hidden = true;
  root.replaceChildren();
}
