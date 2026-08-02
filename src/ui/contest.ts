/**
 * One contest: who is winning, and who owes what.
 *
 * ## Two jobs, and the second is the awkward one
 *
 * While it runs, this is a table. Once it settles, it is a bill, and a bill
 * this app cannot enforce. There is no escrow: Nimiq supports the contract type
 * but the Mini App wallet will only sign ten methods and none of them creates
 * one, so a stake is a promise between two people and this screen is a witness.
 *
 * Everything below follows from taking that seriously rather than dressing it
 * up. The loser is told exactly who to pay and how much, in one tap, in their
 * own wallet. The payment is published beside the debt so the person owed can
 * check it. And the screen says, in plain words, that nothing here can make
 * anybody pay. Implying otherwise would be the one dishonest thing in a product
 * whose whole argument is that its claims are checkable.
 */

import { button, el, mount } from './dom';
import { accountUrl } from '../core/explorer';
import {
  KIND_LABEL,
  clanStandings,
  debtOf,
  obligationsOf,
  stagesLabel,
  standings,
  type Contest,
} from '../data/contests';

export interface ContestOptions {
  contest: Contest;
  meId: string;
  /** Set while a payment is in flight, so the button can say it is working. */
  paying: boolean;
  notice: string | null;
  onPay: () => void;
  onShare: () => void;
  /**
   * Fly the next stage this contest still wants from you.
   *
   * Null when there is nothing to fly: every stage flown, or the contest is
   * over. A button that starts nothing is worse than an absent one.
   */
  onRun: (() => void) | null;
  /** The stage that button would start, for the label. */
  nextStage: number | null;
  /** Set when that stage is not open to this pilot yet. */
  lockedReason: string | null;
  onBack: () => void;
}

export function renderContest(root: HTMLElement, options: ContestOptions): void {
  const { contest } = options;
  const settled = contest.status === 'settled';
  const table = standings(contest);
  const mine = table.find((row) => row.entrant.id === options.meId);

  mount(
    root,
    el(
      'div',
      { class: 'screen contestpage' },

      el('p', { class: 'eyebrow', text: KIND_LABEL[contest.kind] }),
      el('h1', { text: stagesLabel(contest.stages) }),
      el('p', {
        class: 'quiet',
        text: settled
          ? 'Everyone has flown. This is the result.'
          : `${contest.entrants.length} of ${contest.seats} entered. Fly the stages and your scores land here.`,
      }),

      contest.stakeNim > 0
        ? el(
            'div',
            { class: 'contestpage__stake' },
            el('span', { class: 'contest__stakenum', text: String(contest.stakeNim) }),
            el('span', { class: 'contest__stakeunit', text: 'NIM each' }),
          )
        : el('span', { class: 'contest__free', text: 'FREE' }),

      // Your own row first, because "where am I" is the question somebody
      // opening this actually has.
      mine
        ? el(
            'div',
            { class: 'contestpage__you' },
            el('p', { class: 'contestpage__youhead', text: 'YOU' }),
            el('p', {
              class: 'contestpage__yousay',
              text:
                mine.average !== null
                  ? `${mine.average.toLocaleString()} average${mine.place ? `, ${ordinal(mine.place)}` : ''}`
                  : `${mine.flown} of ${mine.of} stages flown`,
            }),
          )
        : null,

      el('p', { class: 'group', text: 'STANDINGS' }),
      el(
        'div',
        { class: 'board' },
        ...table.map((row) => {
          const isMe = row.entrant.id === options.meId;
          return el(
            'div',
            { class: isMe ? 'board__row board__row--you' : 'board__row' },
            el('span', { class: 'board__rank', text: row.place > 0 ? String(row.place) : '·' }),
            row.entrant.avatarUrl
              ? el('img', {
                  class: 'board__avatar',
                  src: row.entrant.avatarUrl,
                  alt: '',
                  referrerpolicy: 'no-referrer',
                  loading: 'lazy',
                })
              : el('div', { class: 'board__avatar' }),
            el(
              'div',
              { class: 'board__who' },
              el(
                'div',
                { class: 'board__name' },
                row.entrant.clanTag
                  ? el('span', { class: 'board__clan', text: row.entrant.clanTag })
                  : null,
                el('span', { text: row.entrant.name }),
              ),
              el('div', {
                class: 'board__tier',
                // An unfinished entrant gets progress, never a provisional
                // score. A partial average is not comparable to a whole one.
                text:
                  row.average !== null
                    ? `${row.of} stage${row.of === 1 ? '' : 's'} flown`
                    : `${row.flown} of ${row.of} flown`,
              }),
            ),
            el('span', {
              class: 'board__score',
              text: row.average !== null ? row.average.toLocaleString() : '—',
            }),
          );
        }),
      ),

      contest.kind === 'clan' ? clanTable(contest) : null,

      settled && contest.stakeNim > 0 ? settlement(options) : null,

      /*
       * The run comes first, because it is the only thing that changes
       * anything. Everything above it is a report.
       */
      options.lockedReason
        ? el('div', { class: 'notice', text: options.lockedReason })
        : null,

      el(
        'div',
        { class: 'actions' },
        options.onRun && options.nextStage !== null
          ? button(`Fly stage ${options.nextStage}`, options.onRun)
          : null,
        button('Share the link', options.onShare, 'ghost'),
        button('Back', options.onBack, 'ghost'),
      ),
    ),
  );
}

/** The clan view, which is the thing a clan contest is actually scored on. */
function clanTable(contest: Contest): HTMLElement {
  const rows = clanStandings(contest);

  return el(
    'div',
    { class: 'contestpage__clans' },
    el('p', { class: 'group', text: 'BY CLAN' }),
    el('p', {
      class: 'quiet',
      // Said here rather than buried, because it is the rule that decides the
      // result and it is not the one people assume.
      text: 'Each clan is scored on the average of the members who finished, so turning up in numbers does not win it.',
    }),
    ...rows.map((row) =>
      el(
        'div',
        { class: 'contestpage__clanrow' },
        el('span', { class: 'board__clan', text: row.tag }),
        el('span', {
          class: 'contestpage__clanwho',
          text: `${row.finished} of ${row.entered} finished`,
        }),
        el('span', {
          class: 'board__score',
          text: row.average !== null ? row.average.toLocaleString() : '—',
        }),
      ),
    ),
  );
}

/**
 * The bill, and an honest account of what it is worth.
 *
 * Three audiences on one panel: somebody who owes, somebody who is owed, and
 * somebody who is neither. Each needs a different sentence, and none of them
 * should be told the app will collect anything.
 */
function settlement(options: ContestOptions): HTMLElement {
  const { contest } = options;
  const all = obligationsOf(contest);
  const debt = debtOf(contest, options.meId);
  const owedToMe = all.filter((o) => o.toId === options.meId);
  const paidByMe = all.find((o) => o.fromId === options.meId && o.txHash);

  return el(
    'div',
    { class: 'settle' },
    el('p', { class: 'settle__head', text: 'SETTLEMENT' }),

    /*
     * Said once, at the top, before any button.
     *
     * There is no escrow and there was no way to build one from inside the
     * wallet. Somebody about to stake should know that here rather than
     * discover it when a loser stops replying.
     */
    el('p', {
      class: 'settle__say',
      text: 'sFace does not hold the stake. It records who owes what and publishes the payment once it is made. Paying is between the two of you, from your own wallets.',
    }),

    debt
      ? el(
          'div',
          { class: 'settle__mine' },
          el('p', {
            class: 'settle__minelead',
            text: `You owe ${debt.nim} NIM to ${debt.toName}.`,
          }),
          debt.toAddress
            ? el('p', { class: 'settle__addr', text: debt.toAddress })
            : el('p', {
                class: 'settle__warn',
                text: 'They have no wallet attached, so there is nowhere to send it.',
              }),
          options.notice ? el('p', { class: 'settle__warn', text: options.notice }) : null,
          debt.toAddress
            ? button(
                options.paying ? 'Waiting for the wallet...' : `Pay ${debt.nim} NIM`,
                options.onPay,
                'primary',
                { disabled: options.paying },
              )
            : null,
        )
      : paidByMe
        ? el('p', { class: 'settle__done', text: 'You have settled this one.' })
        : null,

    owedToMe.length > 0
      ? el(
          'div',
          { class: 'settle__owed' },
          el('p', { class: 'settle__owedhead', text: 'OWED TO YOU' }),
          ...owedToMe.map((o) =>
            el(
              'div',
              { class: 'settle__row' },
              el('span', { class: 'settle__rowwho', text: o.fromId.slice(0, 8) }),
              el('span', { class: 'settle__rowamount', text: `${o.nim} NIM` }),
              o.txHash
                ? el('span', { class: 'settle__rowpaid', text: 'paid' })
                : el('span', { class: 'settle__rowdue', text: 'outstanding' }),
            ),
          ),
        )
      : null,

    // Every reported payment, with a way to check it. A hash nobody can look up
    // is a claim; a hash beside a link is a receipt.
    all.some((o) => o.txHash)
      ? el(
          'div',
          { class: 'settle__receipts' },
          el('p', { class: 'settle__owedhead', text: 'REPORTED PAYMENTS' }),
          ...all
            .filter((o) => o.txHash)
            .map((o) => {
              const url = accountUrl(o.toAddress);
              return el(
                'div',
                { class: 'settle__row' },
                el('span', { class: 'settle__rowwho', text: `${o.fromId.slice(0, 8)} paid ${o.toName}` }),
                url
                  ? el(
                      'a',
                      {
                        class: 'settle__rowlink',
                        href: url,
                        target: '_blank',
                        rel: 'noopener noreferrer',
                      },
                      'check on chain',
                    )
                  : null,
              );
            }),
        )
      : null,

    /*
     * The limit, stated plainly at the bottom too.
     *
     * The service has no Nimiq node, so a reported hash is a claim by the payer
     * rather than something anybody checked. Saying so is what makes the link
     * above worth having.
     */
    all.some((o) => o.txHash)
      ? el('p', {
          class: 'settle__fine',
          text: 'Payments are reported by whoever made them and are not verified here. The link opens the wallet on chain so you can check it yourself.',
        })
      : null,
  );
}

function ordinal(place: number): string {
  const tens = place % 100;
  if (tens >= 11 && tens <= 13) return `${place}th`;
  const ones = place % 10;
  const suffix = ones === 1 ? 'st' : ones === 2 ? 'nd' : ones === 3 ? 'rd' : 'th';
  return `${place}${suffix}`;
}
