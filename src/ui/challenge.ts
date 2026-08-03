/**
 * The challenge screen: create one, accept one, settle one.
 *
 * The honest framing matters here and the copy carries it. sFace never holds
 * the stake. Two players run the same seeded mission, the scores resolve, and
 * the loser sends the winner NIM directly from their own wallet. There is no
 * pot, no escrow, and no moment where this app could run off with anything.
 *
 * The consequence is that a loser can simply not pay. That is a real property
 * of the design and the screen says so rather than implying an enforcement
 * that does not exist.
 */

import { button, el, mount, stat } from './dom';
import { t } from '../data/copy';
import { isExpired, timeLeftLabel } from '../data/contests';
import type { Challenge } from '../net/api';
import type { DailyMission } from '../game/mission';

export interface ChallengeOptions {
  challenge: Challenge;
  mission: DailyMission;
  /**
   * False when the challenge was set on a seed today's mission does not carry,
   * which means the level cannot be reproduced. It is never playable then.
   */
  seedMatches: boolean;
  /** Our device id, or null when the player declined the identifier. */
  meId: string | null;
  walletAvailable: boolean;
  notice: string | null;
  settling: boolean;
  /** Our score this session, when we have already run it. */
  lastScore: number | null;
  onPlay: () => void;
  onSettle: () => void;
  onShare: () => void;
  /**
   * Across to Contests, which is where this idea now lives.
   *
   * The original challenge is one stage against one person. Contests carry
   * stage ranges, seats, clans, standings and settlement, and somebody looking
   * at this screen wondering where the rest of it is should have a door rather
   * than a dead end.
   */
  onContests: () => void;
  onDismiss: () => void;
}

export function renderChallenge(root: HTMLElement, options: ChallengeOptions): void {
  const { challenge, meId } = options;
  const mine = meId !== null && challenge.creatorId === meId;

  const header = el(
    'div',
    { class: 'mission' },
    el(
      'div',
      { class: 'mission__head' },
      el('span', { class: 'mission__ticker', text: challenge.stakeNim.toString() }),
      el('span', { class: 'stat__label', text: 'NIM AT STAKE' }),
    ),
    el(
      'div',
      { class: 'mission__stats' },
      stat('Mission', `${options.mission.ticker} · ${challenge.date}`),
      stat(challenge.creatorName, challenge.creatorScore.toLocaleString()),
    ),
    el('p', { text: t('challengeSame') }),
    /*
     * The deadline, on an open challenge only.
     *
     * Once it has been answered both scores are in and the clock stops
     * mattering, so showing it there would put a countdown next to a result
     * that is already fixed.
     */
    challenge.status === 'open'
      ? el('p', {
          class: isExpired(challenge, Date.now())
            ? 'contestpage__clock contestpage__clock--done'
            : 'contestpage__clock',
          text: isExpired(challenge, Date.now())
            ? 'The clock ran out. This one can no longer be answered.'
            : `${timeLeftLabel(challenge, Date.now())} to answer it`,
        })
      : null,
  );

  const body = resolveBody(options, mine);

  mount(
    root,
    el(
      'div',
      { class: 'screen screen--narrow' },
      el('p', { class: 'eyebrow', text: t('challengeTitle') }),
      el('h1', { text: body.title }),
      header,
      options.notice
        ? el('div', { class: 'notice notice--error', text: options.notice })
        : null,
      body.detail ? el('p', { text: body.detail }) : null,
      body.receipt ?? null,
      el('div', { class: 'actions' }, ...body.actions),
    ),
  );
}

interface Body {
  title: string;
  detail: string | null;
  receipt: HTMLElement | null;
  actions: HTMLElement[];
}

function resolveBody(options: ChallengeOptions, mine: boolean): Body {
  const { challenge } = options;

  if (challenge.status === 'settled') {
    return {
      title: t('challengeSettled'),
      detail: 'The stake moved on chain. The transaction below is the receipt.',
      receipt: challenge.settlementTx
        ? el(
            'div',
            { class: 'mission' },
            el('span', { class: 'stat__label', text: 'REPORTED TRANSACTION' }),
            el('span', { class: 'address', text: challenge.settlementTx }),
            // Say what this is and is not. The service stored what the payer
            // reported, it did not verify it against a node.
            el('p', {
              text: 'Reported by the payer. This build does not run a node, so it is not independently verified.',
            }),
          )
        : null,
      actions: [button('Done', options.onDismiss, 'ghost')],
    };
  }

  if (challenge.status === 'resolved') {
    const iWon = didIWin(options);

    if (iWon === null) {
      return {
        title: 'Challenge resolved',
        detail: `${challenge.creatorName} scored ${challenge.creatorScore.toLocaleString()}, ${
          challenge.opponentName ?? 'the challenger'
        } scored ${(challenge.opponentScore ?? 0).toLocaleString()}.`,
        receipt: null,
        actions: [button('Back', options.onDismiss, 'ghost')],
      };
    }

    if (iWon) {
      return {
        title: t('challengeWon'),
        detail: `They owe you ${challenge.stakeNim} NIM. Settlement is peer to peer, so it lands when they approve it in their wallet.`,
        receipt: null,
        actions: [button('Back', options.onDismiss, 'ghost')],
      };
    }

    return {
      title: t('challengeLost'),
      detail: options.walletAvailable
        ? `Pay ${challenge.stakeNim} NIM straight to the winner. Nimiq Pay will ask you to confirm.`
        : t('challengeNoWallet'),
      receipt: null,
      actions: [
        button(
          options.settling ? 'Waiting on the wallet' : t('challengeSettle'),
          options.onSettle,
          'primary',
        ),
        button('Not now', options.onDismiss, 'quiet'),
      ],
    };
  }

  // Still open.
  if (mine) {
    return {
      title: t('challengeOpen'),
      detail: `Send them the link. They fly the same ${options.mission.ticker} chart from the same seed, so the level is identical.`,
      receipt: null,
      actions: [
        button(t('shareRun'), options.onShare),
        button('Open Contests instead', options.onContests, 'ghost'),
        button('Back', options.onDismiss, 'ghost'),
      ],
    };
  }

  // The level is generated from the seed, so a challenge on a seed we cannot
  // reproduce is not playable at any price. Say why, and offer today's mission
  // instead of a dead end.
  if (!options.seedMatches) {
    return {
      title: 'That challenge has expired',
      detail:
        `It was set on ${challenge.date}'s mission, and today's level is a different chart. ` +
        'Playing it now would not be the same run, so the bet cannot be settled fairly.',
      receipt: null,
      actions: [button("Play today's mission", options.onDismiss)],
    };
  }

  return {
    title: `${challenge.creatorName} scored ${challenge.creatorScore.toLocaleString()}`,
    detail:
      options.lastScore !== null
        ? `You scored ${options.lastScore.toLocaleString()}. Run it again if you want another go before it resolves.`
        : `Beat it and they pay you ${challenge.stakeNim} NIM. Lose and you pay them.`,
    receipt: null,
    actions: [
      button(t('challengeAccept'), options.onPlay),
      button('Not now', options.onDismiss, 'quiet'),
    ],
  };
}

/** True, false, or null when we are a bystander rather than a player. */
function didIWin(options: ChallengeOptions): boolean | null {
  const { challenge, meId } = options;
  if (!meId) return null;
  if (challenge.opponentScore === null) return null;

  const creatorWon = challenge.opponentScore < challenge.creatorScore;

  if (challenge.creatorId === meId) return creatorWon;
  if (challenge.opponentId === meId) return !creatorWon;
  return null;
}
