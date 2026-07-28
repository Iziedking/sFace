/**
 * CT Signals: who actually engages with you, and what they fly for.
 *
 * The screen answers one question a player cannot answer for themselves: of
 * the people who replied to you this week, which are already here and which
 * clan are they in. Picking a clan blind is the weakest thing in the game and
 * this is the fix for it.
 *
 * Three states, and the middle one is the design problem:
 *
 *   no account   Nothing to read. Connect X, or do not.
 *   glance       Real numbers and the top three, free, always.
 *   full         The rest plus the clan overlap, after a small NIM payment.
 *
 * The glance is deliberately useful rather than a teaser that shows nothing. A
 * paywall whose free side is worthless teaches people the paid side is worse,
 * and the numbers on it are the same numbers the deep read is built from.
 *
 * The price is stated as what it is: the X API bill. This repo is MIT and
 * public, so anybody could run it themselves for nothing, and the screen says
 * that rather than implying a lock that is not there.
 */

import { button, el, mount } from './dom';
import type { Engager, Signals } from '../net/api';

export interface SignalsOptions {
  /** The connected handle, or null when no account is connected. */
  handle: string | null;
  signals: Signals | null;
  loading: boolean;
  busy: boolean;
  notice: string | null;
  /** Null when X connect is not configured on this deployment. */
  onConnectX: (() => void) | null;
  onUnlock: () => void;
  onBack: () => void;
}

export function renderSignals(root: HTMLElement, options: SignalsOptions): void {
  mount(
    root,
    el(
      'div',
      { class: 'screen' },
      el('p', { class: 'eyebrow', text: 'CT SIGNALS' }),
      el('h1', { text: 'Who actually talks to you' }),

      options.notice ? el('div', { class: 'notice notice--error', text: options.notice }) : null,

      !options.handle ? connectPanel(options) : body(options),

      el('div', { class: 'actions' }, button('Back', options.onBack, 'ghost')),
    ),
  );
}

/** Nothing to read without a handle, and nothing to apologise for either. */
function connectPanel(options: SignalsOptions): HTMLElement {
  return el(
    'div',
    { class: 'clan' },
    el('p', {
      class: 'clan__pitch',
      text: 'This reads the public replies and mentions on your X account and tells you which of those people already fly here, and what for. It needs to know which account is yours.',
    }),
    options.onConnectX
      ? el('div', { class: 'actions' }, button('Connect X', options.onConnectX, 'x'))
      : el('p', { class: 'quiet', text: 'X connect is not configured on this build.' }),
  );
}

function body(options: SignalsOptions): HTMLElement {
  if (options.loading && !options.signals) {
    return el('p', { class: 'spinner', text: 'Reading the timeline' });
  }

  const signals = options.signals;
  if (!signals) {
    return el('div', {
      class: 'empty',
      text: 'Could not read X just now. Nothing is stored either way, so try again in a minute.',
    });
  }

  return el(
    'div',
    { class: 'signals' },

    el(
      'div',
      { class: 'signals__head' },
      figure(String(signals.reach), 'ACCOUNTS ENGAGED YOU'),
      figure(String(signals.touches), 'REPLIES AND MENTIONS'),
      figure(`@${signals.handle}`, 'READING'),
    ),

    signals.reach === 0
      ? el('div', {
          class: 'empty',
          text: 'A quiet week. Nobody replied to or mentioned you in the last seven days.',
        })
      : null,

    signals.top.length > 0
      ? el(
          'div',
          {},
          el('p', { class: 'stat__label', text: 'YOUR PEOPLE' }),
          el('div', { class: 'engagers' }, ...signals.top.map(engagerRow)),
        )
      : null,

    /*
     * The clan overlap. This is the paid half and the reason the feature
     * exists: one of your engagers in a clan is a coincidence, two or more is
     * a reason to look at it.
     */
    signals.clans.length > 0
      ? el(
          'div',
          {},
          el('p', { class: 'stat__label', text: 'WHERE THEY ALREADY FLY' }),
          el(
            'div',
            { class: 'signals__clans' },
            ...signals.clans.map((clan) =>
              el(
                'div',
                { class: 'signals__clan' },
                el('span', { class: 'clan__tag', text: clan.tag }),
                el('span', {
                  class: 'signals__among',
                  text: `${clan.among} of the people who talk to you`,
                }),
              ),
            ),
          ),
        )
      : null,

    signals.depth === 'glance' && signals.reach > 0 ? unlockPanel(signals, options) : null,

    el('p', {
      class: 'quiet',
      // The privacy posture, stated once, plainly. It is a feature and not a
      // disclaimer: there is nothing to consent to because nothing is kept.
      text: 'Public replies and mentions only, read fresh each time and never stored. No engagement graph is kept about anybody.',
    }),
  );
}

function engagerRow(engager: Engager): HTMLElement {
  return el(
    'div',
    { class: engager.playing ? 'engager engager--here' : 'engager' },
    el('span', { class: 'engager__handle', text: `@${engager.handle}` }),
    el(
      'div',
      { class: 'engager__meta' },
      engager.clanTag
        ? el('span', { class: 'engager__clan', text: engager.clanTag })
        : engager.playing
          ? el('span', { class: 'engager__here', text: 'PLAYS' })
          : null,
      // Ranking is touches first, followers as the tiebreak. Showing both is
      // what stops the order looking arbitrary when two people are level.
      el('span', { class: 'engager__reach', text: compact(engager.followers) }),
      el('span', { class: 'engager__touches', text: `${engager.touches}×` }),
    ),
  );
}

/** 1_240_000 becomes 1.2M. Long numbers in a narrow column read as noise. */
function compact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1000)}K`;
  return String(value);
}

/**
 * The offer.
 *
 * States exactly what the money is for, because a paywall that will not say
 * why it exists reads as a toll. It is the X API bill, and the repo is public.
 */
function unlockPanel(signals: Signals, options: SignalsOptions): HTMLElement {
  const free = signals.treasury === null;

  return el(
    'div',
    { class: 'unlock' },
    el(
      'div',
      { class: 'unlock__body' },
      el('p', {
        class: 'unlock__what',
        text: free
          ? 'The deep read is free on this build.'
          : `${signals.moreAtFull} more, and which clans they already fly for.`,
      }),
      el('p', {
        class: 'unlock__why',
        text: free
          ? 'No treasury is configured here, so there is nothing to pay.'
          : 'Reading X costs money per lookup. This covers it for the day. The code is open, so you could always run your own for nothing.',
      }),
    ),
    button(
      options.busy ? 'Waiting on the wallet' : free ? 'Read it all' : `${signals.priceNim} NIM`,
      options.onUnlock,
    ),
  );
}

function figure(value: string, label: string): HTMLElement {
  return el(
    'div',
    { class: 'signals__figure' },
    el('span', { class: 'signals__value', text: value }),
    el('span', { class: 'stat__label', text: label }),
  );
}
