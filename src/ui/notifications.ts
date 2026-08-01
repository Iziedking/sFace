/**
 * The bell, and what is behind it.
 *
 * ## Why this exists now and did not before
 *
 * Until contests, nothing in the game happened while you were not looking. A
 * run was a run, a board was a board, and the only thing that could arrive
 * unprompted was a clan request nobody was told about: it sat on the clan
 * screen waiting to be discovered, which meant most were never answered.
 *
 * Contests make that worse in every direction. Somebody takes a seat in yours,
 * a clan answers your challenge, a contest you entered settles while you were
 * flying something else. All of it happens off screen, and all of it is
 * actionable, so there has to be one place that says so.
 *
 * ## Deliberately not a feed
 *
 * Everything here is a thing waiting on the player. It is not a history and it
 * is not an activity stream: a bell that fills up with things you cannot act on
 * teaches people to ignore the bell, and then the clan request goes unanswered
 * again with an extra feature in the way.
 *
 * So the rule is that an entry earns its place by having somewhere to go. Tap
 * it and you land where the decision is made, and it stops being unread by
 * being dealt with rather than by being seen.
 */

import { el } from './dom';

export type NotificationKind =
  /** Somebody wants into your clan. Opens the clan screen. */
  | 'clan-request'
  /** A clan you asked to join answered. Opens the clan screen. */
  | 'clan-answer'
  /** Somebody took a seat in a contest of yours. Opens the contest. */
  | 'contest-joined'
  /** A contest you are in has a result. Opens the contest. */
  | 'contest-settled'
  /** A contest you are in is waiting on stages you have not flown. */
  | 'contest-waiting';

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  /** One line. The whole point is that it is readable at a glance. */
  text: string;
  /** When it happened, so the list can be ordered honestly. */
  at: number;
  /** Where tapping it goes. An entry with nowhere to go does not belong here. */
  go: () => void;
}

export interface BellOptions {
  items: AppNotification[];
  open: boolean;
  onToggle: () => void;
  /** Dismiss everything. Never deletes anything that still needs doing. */
  onClearAll: () => void;
}

/**
 * The bell itself, for the app bar.
 *
 * Returns the button; the panel is mounted separately so it can escape the
 * bar's own stacking context rather than being clipped by it.
 */
export function bell(options: BellOptions): HTMLElement {
  const count = options.items.length;

  const node = el(
    'button',
    {
      class: options.open ? 'chrome__bell chrome__bell--open' : 'chrome__bell',
      type: 'button',
      'aria-expanded': options.open ? 'true' : 'false',
      'aria-label':
        count > 0
          ? `${count} thing${count === 1 ? '' : 's'} waiting on you`
          : 'Nothing waiting on you',
    },
    el('span', { class: 'chrome__bellicon', text: '🔔' }),
    /*
     * A count, not a dot.
     *
     * A dot says something happened. A number says how much is waiting, which
     * is the difference between "I will look later" and "I should look now".
     * Capped at nine plus, because past that the exact figure changes nothing.
     */
    count > 0
      ? el('span', { class: 'chrome__bellcount', text: count > 9 ? '9+' : String(count) })
      : null,
  );

  node.addEventListener('click', options.onToggle);
  return node;
}

/** The panel. Null when closed, so there is nothing in the tree to trip over. */
export function bellPanel(options: BellOptions): HTMLElement | null {
  if (!options.open) return null;

  const items = [...options.items].sort((a, b) => b.at - a.at);

  const panel = el(
    'div',
    { class: 'bellpanel', role: 'dialog', 'aria-label': 'Waiting on you' },
    el(
      'div',
      { class: 'bellpanel__head' },
      el('span', { class: 'bellpanel__title', text: 'WAITING ON YOU' }),
      items.length > 0 ? clearButton(options) : null,
    ),
    items.length === 0
      ? el('p', {
          class: 'bellpanel__empty',
          // Said as a state rather than an apology. Nothing waiting is good news.
          text: 'Nothing right now. Clan requests, contest seats and results land here.',
        })
      : el('div', { class: 'bellpanel__list' }, ...items.map((item) => row(item, options))),
  );

  return panel;
}

function clearButton(options: BellOptions): HTMLElement {
  const node = el('button', {
    class: 'bellpanel__clear',
    type: 'button',
    text: 'Clear',
  });
  node.addEventListener('click', options.onClearAll);
  return node;
}

function row(item: AppNotification, options: BellOptions): HTMLElement {
  const node = el(
    'button',
    { class: 'bellrow', type: 'button' },
    el('span', { class: `bellrow__kind bellrow__kind--${item.kind}` }),
    el(
      'div',
      { class: 'bellrow__body' },
      el('span', { class: 'bellrow__text', text: item.text }),
      el('span', { class: 'bellrow__when', text: ago(item.at) }),
    ),
  );

  node.addEventListener('click', () => {
    // Close first, then travel. Leaving the panel open over the screen it just
    // opened would cover the decision it sent you to make.
    options.onToggle();
    item.go();
  });

  return node;
}

/**
 * How long ago, roughly.
 *
 * Rough on purpose. Nothing here is time critical to the minute, and an exact
 * timestamp on a notification invites reading precision into something that is
 * only ever "recently" or "a while back".
 */
function ago(at: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return 'just now';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
