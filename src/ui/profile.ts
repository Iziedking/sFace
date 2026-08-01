/**
 * Everything that is yours, on one page.
 *
 * ## Why this exists
 *
 * The home page had grown to fourteen controls: a primary button, two sign-in
 * actions, six tiles and a row of four toggles. Every one of them was
 * defensible on its own and together they said that fourteen things mattered
 * equally, which is the same as saying nothing does. A new player could not
 * tell the difference between "Loadout", "Signals" and "Sound off".
 *
 * So the home page keeps what a player came to do, and the two things that are
 * about *them* rather than about today move here and into Settings. This one
 * answers "what have I got": rank, Face, balance, clan, challenge, gun. All
 * state, no preferences. Anything you would change about the app rather than
 * about your pilot is next door.
 *
 * ## Honest states, not zeroes
 *
 * Three things on this page can genuinely be unknown rather than empty: the
 * balance when there is no wallet or no node, the clan when there is none, and
 * the rank before a first run. Each says so in words. A page like this is only
 * worth having if every number on it can be believed, and the fastest way to
 * lose that is to render a missing value as zero.
 */

import { button, el, mount } from './dom';
import { rankFor } from '../data/story';
import type { Profile } from '../net/profile';
import { networkLabel } from '../core/network';

export interface ProfileOptions {
  /** The pilot's record, or null before their first finished run. */
  profile: Profile | null;
  /** The connected account chip, when they have connected one. */
  me: HTMLElement | null;
  /** Shortened wallet address, or null when no wallet is attached. */
  walletAddress: string | null;
  /**
   * NIM in hand.
   *
   * Three states, and they are all different. A number is a balance. `null` is
   * "we could not find out", which happens in a browser with no wallet and in
   * a wallet whose host serves no RPC. `undefined` is "still asking", so the
   * card can say it is working rather than flashing an error and correcting
   * itself a moment later.
   */
  balanceNim: number | null | undefined;
  /** What is in hand, named so the rack is never a mystery box. */
  weaponName: string;
  /** The pilot's clan tag, or null. */
  clanTag: string | null;
  /** Clan requests waiting on this pilot to decide, when they own one. */
  clanPending: number;
  /** An open challenge they can walk back into, or null. */
  openChallenge: { id: string; stakeNim: number } | null;

  onLoadout: () => void;
  onClan: () => void;
  onSignals: () => void;
  onChallenge: () => void;
  onChallengeFriend: () => void;
  onBack: () => void;
}

export function renderProfile(root: HTMLElement, options: ProfileOptions): void {
  const { profile } = options;
  const progress = rankFor(profile?.lifetimeFace ?? 0);
  const flown = profile !== null && profile.runs > 0;

  mount(
    root,
    el(
      'div',
      { class: 'screen profile' },

      el('p', { class: 'eyebrow', text: 'Profile' }),
      el('h1', { text: profile?.name ?? 'Your pilot' }),
      options.me,

      /*
       * Rank first, because it is the one number that took work.
       *
       * Before a first run there is no rank to show and a tier one badge would
       * be claiming a standing nobody has yet, so it says what to do instead.
       */
      flown
        ? el(
            'div',
            { class: 'profile__rank' },
            el('p', { class: 'profile__ranktier', text: `TIER ${progress.rank.tier}` }),
            el('p', { class: 'profile__rankname', text: progress.rank.name }),
            el(
              'div',
              { class: 'profile__bar' },
              el('span', {
                class: 'profile__barfill',
                style: `width:${Math.round(progress.fraction * 100)}%`,
              }),
            ),
            el('p', {
              class: 'profile__ranknext',
              text: progress.next
                ? `${progress.remaining.toLocaleString()} Face to ${progress.next.name}`
                : 'Nothing above this one.',
            }),
          )
        : el('div', {
            class: 'notice',
            text: 'Finish a run and this fills in: rank, lifetime Face, and where you sit all time.',
          }),

      flown
        ? el(
            'div',
            { class: 'profile__stats' },
            figure('FACE', (profile?.lifetimeFace ?? 0).toLocaleString()),
            figure('BEST RUN', (profile?.bestScore ?? 0).toLocaleString()),
            figure('RUNS', String(profile?.runs ?? 0)),
            figure('RESCUED', String(profile?.rescued ?? 0)),
            figure(
              'ALL TIME',
              profile?.allTimeRank ? `#${profile.allTimeRank}` : 'unranked',
            ),
            figure('STAGES', `${profile?.stagesCleared ?? 0}/7`),
          )
        : null,

      /*
       * The wallet, and what is in it.
       *
       * Scoped to the network showing in the bar, because the same address
       * holds two entirely different balances and a figure with no chain
       * beside it is worse than no figure.
       */
      el(
        'div',
        { class: 'profile__wallet' },
        el('p', { class: 'profile__head', text: `WALLET · ${networkLabel().toUpperCase()}` }),
        options.walletAddress
          ? el('p', { class: 'profile__addr', text: options.walletAddress })
          : el('p', {
              class: 'profile__say',
              text: 'No wallet attached. Open sFace inside Nimiq Pay, or connect from the home page.',
            }),
        options.walletAddress ? balanceLine(options.balanceNim) : null,
      ),

      el(
        'div',
        { class: 'tiles' },
        tile('Loadout', options.weaponName, options.onLoadout),
        tile(
          'Clan',
          options.clanTag
            ? options.clanPending > 0
              ? `${options.clanTag} · ${options.clanPending} waiting`
              : options.clanTag
            : 'none yet',
          options.onClan,
          options.clanPending > 0,
        ),
        options.openChallenge
          ? tile(
              'Challenge',
              `${options.openChallenge.stakeNim} NIM open`,
              options.onChallenge,
              true,
            )
          : null,
        tile('Signals', 'who talks to you', options.onSignals),
        /*
         * Opening a contest lives here rather than on the home page.
         *
         * It is a thing you do with your own account: your clan, your stake,
         * your stages. Contests on the home page is where you go to find one
         * somebody else opened.
         */
        tile('Challenge a friend', 'set the terms', options.onChallengeFriend),
      ),

      el('div', { class: 'actions' }, button('Done', options.onBack)),
    ),
  );
}

/**
 * The balance, or an honest sentence about why there isn't one.
 *
 * `undefined` while the read is in flight, `null` when it failed. Rendering
 * either as "0 NIM" would be inventing a fact, and it is the one number on
 * this page somebody might act on.
 */
function balanceLine(nim: number | null | undefined): HTMLElement {
  if (nim === undefined) {
    return el('p', { class: 'profile__say', text: 'Reading the balance...' });
  }

  if (nim === null) {
    return el('p', {
      class: 'profile__say',
      text: 'Balance unavailable here. Your wallet still knows it, and it is what any stake is approved against.',
    });
  }

  return el(
    'p',
    { class: 'profile__balance' },
    el('span', {
      class: 'profile__balancenum',
      // Two decimals is enough to be useful and few enough to read at a
      // glance. Lunas are not money anybody thinks in.
      text: nim.toLocaleString(undefined, { maximumFractionDigits: 2 }),
    }),
    el('span', { class: 'profile__balanceunit', text: 'NIM' }),
  );
}

function figure(label: string, value: string): HTMLElement {
  return el(
    'div',
    { class: 'profile__figure' },
    el('span', { class: 'profile__figurevalue', text: value }),
    el('span', { class: 'profile__figurelabel', text: label }),
  );
}

/** Same square as the home grid, so the two pages read as one system. */
function tile(
  label: string,
  value: string,
  onClick: () => void,
  live = false,
): HTMLElement {
  const node = el(
    'button',
    { class: live ? 'tile tile--live' : 'tile', type: 'button' },
    el('span', { class: 'tile__label', text: label }),
    el('span', { class: 'tile__value', text: value }),
  );
  node.addEventListener('click', onClick);
  return node;
}
