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
import type { Profile, UnsignedRun } from '../net/profile';
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
  /**
   * Signing a run that reached the board without a signature.
   *
   * Null when there is nothing to sign or no wallet that could, so the card is
   * absent rather than a button that cannot work.
   */
  onSignRun: ((run: UnsignedRun) => void) | null;
  signingRun: boolean;
  signNotice: string | null;
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
            text: 'Finish a run and this fills in with your rank, lifetime Face and where you sit all time.',
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

      unsignedRuns(options),
      settlementRecord(profile),

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
 * Runs on the board that were never signed.
 *
 * ## Why this is a reminder and not a warning
 *
 * Nothing is wrong. An unsigned row counts, ranks and pays Face exactly like
 * any other, and a plain browser has produced nothing else since the board
 * existed. What it cannot do is prove whose run it was.
 *
 * So this offers rather than nags. It names what signing buys, in the same
 * words the results screen uses, and it is absent entirely when there is
 * nothing outstanding or no wallet to sign with. A permanent panel saying "0
 * runs unsigned" would be the profile congratulating somebody for nothing.
 *
 * ## Why it exists at all
 *
 * Signing used to be possible only in the session that produced the run. Miss
 * the moment, refresh, and the chance was gone, which meant the honest answer
 * to "can I sign that one from this morning" was no. The board records the
 * level on every row now, so it can always be reconstructed, and this is where
 * somebody goes looking.
 */
function unsignedRuns(options: ProfileOptions): HTMLElement | null {
  const runs = options.profile?.unsigned ?? [];
  if (runs.length === 0 || !options.onSignRun) return null;

  const first = runs[0]!;
  const more = runs.length - 1;

  return el(
    'div',
    { class: 'unsigned' },
    el('p', { class: 'unsigned__head', text: 'NOT SIGNED YET' }),
    el('p', {
      class: 'unsigned__figure',
      text:
        runs.length === 1
          ? `${first.score.toLocaleString()} on stage ${first.stage}`
          : `${runs.length} runs, latest ${first.score.toLocaleString()} on stage ${first.stage}`,
    }),
    el('p', {
      class: 'unsigned__say',
      text: 'The run counts and ranks either way. Signing publishes a signature next to it so anyone can check the run was yours. It costs no NIM and sends no transaction.',
    }),
    options.signNotice ? el('p', { class: 'unsigned__warn', text: options.signNotice }) : null,
    el(
      'div',
      { class: 'actions' },
      button(
        options.signingRun ? 'Waiting for the wallet...' : `Sign the ${first.date} run`,
        () => options.onSignRun?.(first),
        'ghost',
        { disabled: options.signingRun },
      ),
    ),
    // Said once rather than listed. The button takes the newest and the card
    // comes back for the next one, which is less to read and the same work.
    more > 0
      ? el('p', { class: 'unsigned__more', text: `${more} older ${more === 1 ? 'run' : 'runs'} after this one.` })
      : null,
  );
}

/**
 * Whether this pilot pays what they lose.
 *
 * ## Why a game has a credit rating
 *
 * There is no escrow. Nimiq supports the contract type, but the Mini App wallet
 * signs ten methods and none of them creates one, so nothing can hold a stake
 * while a contest is flown. A staked contest is a promise between two people.
 *
 * That leaves one useful thing to build: make the promise legible. Somebody
 * deciding whether to stake against a stranger has exactly one question, and
 * this is the answer to it. It enforces nothing and is not pretending to.
 *
 * ## Absent until it means something
 *
 * Hidden for anybody who has never been billed, rather than shown as zero of
 * zero. A fresh player has not failed to pay anything, and a record implying
 * otherwise would be the panel accusing somebody of nothing.
 */
function settlementRecord(profile: Profile | null): HTMLElement | null {
  const owed = profile?.stakesOwed ?? 0;
  if (!profile || owed === 0) return null;

  const settled = Math.min(owed, profile.stakesSettled);
  const outstanding = owed - settled;
  const clean = outstanding === 0;

  return el(
    'div',
    { class: clean ? 'record record--clean' : 'record' },
    el('p', { class: 'record__head', text: 'SETTLEMENT RECORD' }),
    el('p', {
      class: 'record__figure',
      text: `Settled ${settled} of ${owed}`,
    }),
    el('p', {
      class: 'record__say',
      text: clean
        ? 'You have paid every staked contest you lost. Nothing forces this, so it is worth showing.'
        : `${outstanding} still outstanding. sFace cannot collect it, and this line is on your profile until you do.`,
    }),
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
      text: 'Balance not available here. Your wallet still knows it, and that is what a stake is approved against.',
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
