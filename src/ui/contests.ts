/**
 * Everything open to enter, in one place.
 *
 * ## Why this is its own screen
 *
 * A challenge used to exist only as a link somebody sent you after a run. That
 * makes it a thing you can be invited to and never a thing you can go and find,
 * so a player with nobody to play against had no route in at all. This is that
 * route: the contests anybody may take a seat in, listed.
 *
 * Private contests are deliberately absent. Somebody who opened one for a
 * specific friend has said who it is for, and surfacing it here would quietly
 * override that. The link is the whole access control and it is enough.
 *
 * ## What a card has to answer
 *
 * Before entering, a person wants to know four things: what kind of contest it
 * is, how much flying it involves, what it costs, and whether there is room.
 * Every card leads with those four and nothing else competes with them. The
 * standings live on the contest's own page, because a list is for choosing and
 * a page is for following.
 */

import { button, el, mount } from './dom';
import {
  KIND_LABEL,
  KIND_SAY,
  seatsLeft,
  stagesLabel,
  type Contest,
  type ContestKind,
} from '../data/contests';

/** The filter, including the one that filters nothing. */
export type ContestFilter = 'all' | ContestKind;

export interface ContestsOptions {
  contests: Contest[];
  loading: boolean;
  /** Set when the list could not be read, so it can say so instead of empty. */
  offline: string | null;
  filter: ContestFilter;
  /** Who is looking, so a card can say why they cannot enter this one. */
  me: { id: string; clanTag: string | null };
  /** Why a join was refused, keyed by contest id. Filled in after a failure. */
  notices: Record<string, string>;
  /** The contest currently being joined, so its button can say it is working. */
  joining: string | null;

  onFilter: (next: ContestFilter) => void;
  onJoin: (contest: Contest) => void;
  onOpen: (contest: Contest) => void;
  /** Opening one of your own. Lives in the profile, linked from the empty state. */
  onCreate: () => void;
  onBack: () => void;
}

const FILTERS: Array<{ id: ContestFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'duel', label: 'Head to head' },
  { id: 'clan', label: 'Clans' },
  { id: 'gauntlet', label: 'Survival' },
];

export function renderContests(root: HTMLElement, options: ContestsOptions): void {
  const shown =
    options.filter === 'all'
      ? options.contests
      : options.contests.filter((c) => c.kind === options.filter);

  mount(
    root,
    el(
      'div',
      { class: 'screen contests' },

      el('p', { class: 'eyebrow', text: 'Contests' }),
      el('h1', { text: 'Open to enter' }),
      el('p', {
        class: 'quiet',
        text: 'Everyone in a contest flies the identical level. Assist is pinned to the baseline for all sides, so it settles on who flew better today rather than who has been playing longest.',
      }),

      el(
        'div',
        { class: 'tabs tabs--wrap' },
        ...FILTERS.map((f) =>
          filterTab(f.label, options.filter === f.id, () => options.onFilter(f.id)),
        ),
      ),

      options.offline
        ? el('div', { class: 'notice notice--error', text: options.offline })
        : null,

      options.loading
        ? el('p', { class: 'spinner', text: 'Reading the contests' })
        : shown.length > 0
          ? el('div', { class: 'contests__list' }, ...shown.map((c) => card(c, options)))
          : emptyState(options),

      el(
        'div',
        { class: 'actions' },
        button('Open a contest', options.onCreate),
        button('Back', options.onBack, 'ghost'),
      ),
    ),
  );
}

function emptyState(options: ContestsOptions): HTMLElement {
  return el(
    'div',
    { class: 'empty' },
    el('p', {
      text:
        options.filter === 'all'
          ? 'Nothing open right now.'
          : `No ${FILTERS.find((f) => f.id === options.filter)?.label.toLowerCase()} contests open right now.`,
    }),
    // An empty list is a prompt, not a dead end. Somebody who came looking for
    // a contest is exactly the person who should be offered one to open.
    el('p', {
      class: 'quiet',
      text: 'Open one and it appears here for anybody to take a seat in, or keep it private and share the link with whoever you meant it for.',
    }),
  );
}

function card(contest: Contest, options: ContestsOptions): HTMLElement {
  const left = seatsLeft(contest);
  const mine = contest.hostId === options.me.id;
  const entered = contest.entrants.some((e) => e.id === options.me.id);
  const notice = options.notices[contest.id] ?? null;
  const busy = options.joining === contest.id;

  const node = el(
    'div',
    { class: 'contest' },

    el(
      'div',
      { class: 'contest__head' },
      el('span', { class: `contest__kind contest__kind--${contest.kind}`, text: KIND_LABEL[contest.kind] }),
      contest.clanTag ? el('span', { class: 'contest__clan', text: contest.clanTag }) : null,
      // Seats read as a countdown rather than a fraction: "2 left" is the thing
      // that decides whether to enter now, and "4 of 6" makes you do the sum.
      el('span', {
        class: left > 0 ? 'contest__seats' : 'contest__seats contest__seats--full',
        text: left > 0 ? `${left} seat${left === 1 ? '' : 's'} left` : 'Full',
      }),
    ),

    el('p', { class: 'contest__stages', text: stagesLabel(contest.stages) }),
    el('p', { class: 'contest__say', text: KIND_SAY[contest.kind] }),

    el(
      'div',
      { class: 'contest__foot' },
      el(
        'div',
        { class: 'contest__host' },
        contest.hostAvatarUrl
          ? el('img', {
              class: 'contest__avatar',
              src: contest.hostAvatarUrl,
              alt: '',
              referrerpolicy: 'no-referrer',
              loading: 'lazy',
            })
          : el('div', { class: 'contest__avatar' }),
        el('span', { text: mine ? 'Opened by you' : contest.hostName }),
      ),
      el(
        'div',
        { class: 'contest__stake' },
        el('span', { class: 'contest__stakenum', text: String(contest.stakeNim) }),
        el('span', { class: 'contest__stakeunit', text: 'NIM' }),
      ),
    ),

    notice ? el('p', { class: 'contest__notice', text: notice }) : null,

    el(
      'div',
      { class: 'contest__actions' },
      entered || mine
        ? button('Open', () => options.onOpen(contest), 'ghost')
        : button(busy ? 'Taking a seat...' : 'Take a seat', () => options.onJoin(contest), 'ghost', {
            disabled: busy || left <= 0,
          }),
    ),
  );

  return node;
}

/**
 * A filter chip.
 *
 * Its own function rather than the board's `tab`, because that one lives in
 * screens.ts behind renderBoard and importing a screen from a screen to reuse
 * six lines would tie two files together for no gain.
 */
function filterTab(label: string, active: boolean, onClick: () => void): HTMLElement {
  const node = el('button', {
    class: active ? 'tab tab--on' : 'tab',
    type: 'button',
    text: label,
    'aria-pressed': active ? 'true' : 'false',
  });
  node.addEventListener('click', onClick);
  return node;
}
