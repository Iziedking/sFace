/**
 * The screens either side of a run.
 *
 * Onboarding under sixty seconds is an explicit judging criterion, so the
 * briefing is one screen with one primary button and no forms, no signup, and
 * no wallet prompt before the first run. The wallet is asked for at the moment
 * it buys the player something, which is when they want to stake or post a
 * score, and never as a toll gate on the way in.
 *
 * Every screen is a pure render into #ui with callbacks out. They hold no state
 * and they never touch the run.
 */

import { button, el, mount, row, stat } from './dom';
import { t, difficultyLabel } from '../data/copy';
import type { DailyMission } from '../game/mission';
import type { RunState } from '../game/state';
import { ATTACKER_SCORE, TIME_BONUS_PER_SECOND } from '../game/state';
import type { BoardEntry } from '../net/api';

export function renderLoading(root: HTMLElement, text: string): void {
  mount(
    root,
    el(
      'div',
      { class: 'screen screen--center' },
      el('p', { class: 'spinner', text }),
    ),
  );
}

export interface BriefOptions {
  mission: DailyMission;
  notice: string | null;
  /** Shown only before the very first run of a session. */
  showHints: boolean;
  onStart: () => void;
  onBoard: () => void;
}

export function renderBrief(root: HTMLElement, options: BriefOptions): void {
  const { mission } = options;

  const head = el(
    'div',
    { class: 'mission__head' },
    el('span', { class: 'mission__ticker', text: mission.ticker }),
    mission.live
      ? el('span', {
          class: 'mission__change',
          text: `${mission.changePct.toFixed(1)}%`,
        })
      : null,
  );

  const card = el(
    'div',
    { class: 'mission' },
    head,
    el('p', { text: mission.coinName }),
    el(
      'div',
      { class: 'mission__stats' },
      stat(t('fearIndex'), `${mission.fearGreed} · ${difficultyLabel(mission.fearGreed)}`),
      stat(t('difficulty'), `${mission.difficulty} of 5`),
    ),
  );

  const hints = options.showHints
    ? el(
        'ul',
        { class: 'hints' },
        el('li', { text: t('controlsMove') }),
        el('li', { text: t('controlsShoot') }),
        el('li', { text: t('controlsRescue') }),
      )
    : null;

  mount(
    root,
    el(
      'div',
      { class: 'screen screen--center' },
      el('p', { class: 'eyebrow', text: t('missionToday') }),
      el('h1', { text: t('tagline') }),
      card,
      options.notice ? el('div', { class: 'notice', text: options.notice }) : null,
      el('p', { text: t('briefBody') }),
      hints,
      el(
        'div',
        { class: 'actions' },
        button(t('startRun'), options.onStart),
        button(t('viewBoard'), options.onBoard, 'ghost'),
      ),
    ),
  );
}

export interface ResultsOptions {
  state: RunState;
  /** Null while the card is still rendering. */
  cardUrl: string | null;
  /** Set when posting the score failed, so we can say so instead of lying. */
  postError: string | null;
  rank: number | null;
  onReplay: () => void;
  onChallenge: () => void;
  onShare: () => void;
  onBoard: () => void;
}

export function renderResults(root: HTMLElement, options: ResultsOptions): void {
  const { state } = options;
  const survived = state.phase === 'extracted';

  const timeBonus = survived ? Math.floor(state.timeLeft * TIME_BONUS_PER_SECOND) : 0;

  const breakdown = el(
    'div',
    { class: 'breakdown' },
    row(t('faces'), `${state.facesExtracted} of ${state.faces.length}`),
    row(t('attackers'), `${state.attackersCleared} × ${ATTACKER_SCORE}`),
    row(t('timeBonus'), timeBonus.toLocaleString()),
    row(t('bounty'), `×${state.mission.bountyMultiplier.toFixed(2)}`),
  );

  const lostCount = state.faces.filter((f) => f.state === 'lost').length;

  mount(
    root,
    el(
      'div',
      { class: 'screen screen--center' },
      el('p', { class: 'eyebrow', text: `${state.mission.ticker} · ${state.mission.date}` }),
      el('h1', { text: survived ? t('runComplete') : t('runFailed') }),

      // If faces were lost, say it plainly. Burying it would make the score
      // look better and teach the player nothing.
      lostCount > 0
        ? el('div', {
            class: 'notice notice--error',
            text: `${lostCount} still in the wreck.`,
          })
        : null,

      el(
        'div',
        { class: 'score' },
        el('span', { class: 'stat__label', text: t('score') }),
        el('span', { class: 'score__value', text: state.score.toLocaleString() }),
        options.rank !== null
          ? el('span', { class: 'stat__label', text: `Rank ${options.rank} today` })
          : null,
      ),

      breakdown,

      options.postError
        ? el('div', { class: 'notice notice--error', text: options.postError })
        : null,

      options.cardUrl
        ? el('img', {
            class: 'card-preview',
            src: options.cardUrl,
            alt: `Score card: ${state.score} points on ${state.mission.ticker}`,
          })
        : null,

      el(
        'div',
        { class: 'actions' },
        button(t('playAgain'), options.onReplay),
        button(t('challengeFriend'), options.onChallenge, 'ghost'),
        button(t('shareRun'), options.onShare, 'ghost'),
        button(t('viewBoard'), options.onBoard, 'quiet'),
      ),
    ),
  );
}

export interface BoardOptions {
  mission: DailyMission;
  entries: BoardEntry[];
  /** Our own device id, so we can mark our row. */
  meId: string | null;
  offline: boolean;
  onBack: () => void;
}

export function renderBoard(root: HTMLElement, options: BoardOptions): void {
  const rows = options.entries.map((entry, index) =>
    el(
      'div',
      { class: entry.id === options.meId ? 'board__row board__row--you' : 'board__row' },
      el('span', { class: 'board__rank', text: `${index + 1}` }),
      el('span', { text: entry.id === options.meId ? t('boardYou') : entry.name }),
      el('span', { class: 'board__score', text: entry.score.toLocaleString() }),
    ),
  );

  mount(
    root,
    el(
      'div',
      { class: 'screen' },
      el('p', { class: 'eyebrow', text: `${t('boardTitle')} · ${options.mission.ticker}` }),
      el('h1', { text: t('boardTitle') }),
      options.offline
        ? el('div', { class: 'notice notice--error', text: t('boardOffline') })
        : null,
      rows.length > 0
        ? el('div', { class: 'board' }, ...rows)
        : el('div', { class: 'empty', text: t('boardEmpty') }),
      el('div', { class: 'actions' }, button('Back', options.onBack, 'ghost')),
    ),
  );
}
