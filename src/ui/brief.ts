/**
 * The card that drops in when a stage starts.
 *
 * ## Why it exists
 *
 * Every stage had a brief on the campaign screen and then you pressed start and
 * were simply in a city, holding a gun, with no reminder of what the job was.
 * The stage's whole identity lived on a card you had already scrolled past. The
 * two most common questions after a playtest were what am I meant to be doing
 * and which stage is this, and both were answered in text the player last saw a
 * screen ago.
 *
 * So the brief comes with you. Same three facts every stage, in the same place,
 * for long enough to read.
 *
 * ## The motion: written out, then held, then gone
 *
 * Words arrive ONE AT A TIME, left to right, as though the brief were being
 * typed in front of you. Then the whole thing sits still, complete, for long
 * enough to reread. Only then does it leave.
 *
 * The first version staggered whole LINES a sixth of a second apart, which put
 * everything on screen inside half a second and read as a splash rather than as
 * something being said. Per-word at a readable cadence is the difference between
 * a card appearing and a card explaining itself, and it means a player who looks
 * up mid-way still catches the sentence being built rather than finding a block
 * of text already there.
 *
 * The hold starts when the LAST word lands, not when the card appears, so the
 * time spent reading is time the text is actually complete.
 *
 * The exit is per-word too. A card that vanishes as a block cannot be told apart
 * from one that was cut off, which is the complaint this whole thing came from.
 *
 * ## The cadence is measured, not chosen
 *
 * Reveal speed comes from a words-per-minute figure rather than a number that
 * looked right, so a four word objective and a twelve word one are both read at
 * the same pace instead of one feeling rushed.
 */

import { el, mount } from './dom';
import { reducedMotion } from '../render/theme';
import type { Stage } from '../data/campaign';
import type { DailyMission } from '../game/mission';

export interface BriefCardOptions {
  stage: Stage;
  mission: DailyMission;
  /** Called once the card is gone and the run may begin. */
  onDone: () => void;
}

/**
 * Seconds between one word appearing and the next.
 *
 * Three hundred and forty words a minute. Comfortably faster than reading aloud
 * and slow enough that the text is visibly being written rather than switched
 * on, which is the whole difference between this and a splash.
 */
const WORD_IN_STAGGER = 60 / 340;
/** How long a single word takes to land. */
const WORD_IN_SECONDS = 0.26;

/**
 * How long the completed card sits there.
 *
 * Timed from the last word landing, so this is time the brief is whole. Fixed
 * rather than scaled by length, because the reveal already took longer for a
 * longer brief and scaling both would compound.
 */
const HOLD_SECONDS = 2.6;

/** Seconds between words as the card empties. */
const WORD_OUT_STAGGER = 0.045;
/** How long one word takes to leave. */
const WORD_OUT_SECONDS = 0.32;

/**
 * Show the brief, then call onDone.
 *
 * Returns a cancel function. The caller needs it because a player can quit or
 * be pulled to another screen mid-card, and a pending timer that then starts a
 * run underneath a different screen is the kind of bug that is very hard to see
 * and very easy to prevent.
 */
export function showBriefCard(root: HTMLElement, options: BriefCardOptions): () => void {
  const { stage, mission } = options;

  /*
   * One running index across the WHOLE card, not per line.
   *
   * The reveal has to read as one sentence being written, so word five of the
   * title must wait for words one to four of the kicker. Numbering per line made
   * all four lines start writing at once, which is four things happening at
   * different speeds rather than one thing being said.
   */
  let order = 0;

  const words = (text: string, className: string): HTMLElement =>
    el(
      'span',
      { class: className },
      ...text.split(/\s+/).map((word) =>
        el('span', { class: 'brief__word', text: word, style: `--w:${order++}` }),
      ),
    );

  const card = el(
    'div',
    { class: 'brief', role: 'status', 'aria-live': 'polite' },
    el('div', { class: 'brief__line' }, words(`Stage ${stage.n}`, 'brief__kicker')),
    el('div', { class: 'brief__line' }, words(stage.name, 'brief__title')),
    el('div', { class: 'brief__line' }, words(stage.objective, 'brief__objective')),
    /*
     * The day, last and quietest.
     *
     * It is the premise of the entire game, so it belongs on the card, but it is
     * not the instruction. A practice mission has no percentage to show and
     * prints its ticker alone rather than a fake zero.
     */
    el(
      'div',
      { class: 'brief__line' },
      words(
        mission.live
          ? `${mission.ticker} ${mission.changePct.toFixed(1)}% today`
          : `${mission.ticker} run`,
        'brief__day',
      ),
    ),
  );

  const layer = el('div', { class: 'brief-layer' }, card);
  root.className = 'is-hud';
  mount(root, layer);

  let finished = false;
  const timers: number[] = [];

  const finish = (): void => {
    if (finished) return;
    finished = true;
    for (const timer of timers) window.clearTimeout(timer);
    window.removeEventListener('keydown', finish);
    layer.remove();
    options.onDone();
  };

  /*
   * Reduced motion gets the same information and none of the movement.
   *
   * Not a shorter card: someone who has asked the OS to stop animations still
   * needs to read the objective, and cutting their reading time because they
   * dislike motion would be the wrong trade entirely. They get the whole card at
   * once and the same hold.
   */
  if (reducedMotion()) {
    card.classList.add('brief--still');
    timers.push(window.setTimeout(finish, (HOLD_SECONDS + 1) * 1000));
    window.addEventListener('keydown', finish);
    card.addEventListener('pointerdown', finish);
    return finish;
  }

  // When the last word has landed. Everything after is measured from here.
  const revealed = WORD_IN_STAGGER * (order - 1) + WORD_IN_SECONDS;
  const emptied = WORD_OUT_STAGGER * (order - 1) + WORD_OUT_SECONDS;

  timers.push(
    window.setTimeout(() => card.classList.add('brief--out'), (revealed + HOLD_SECONDS) * 1000),
  );
  timers.push(window.setTimeout(finish, (revealed + HOLD_SECONDS + emptied) * 1000));

  /*
   * Dismissed by a key, or by tapping the card itself. NOT by tapping anywhere.
   *
   * A window-wide listener was wrong on a phone: both thumbs go to the pads the
   * instant a run starts, so the first touch of every run killed the brief before
   * a word of it had been read. The card is pinned at the top, clear of where a
   * thumb rests, so tapping it is a deliberate act and touching the controls is
   * not.
   */
  window.addEventListener('keydown', finish);
  card.addEventListener('pointerdown', finish);

  return finish;
}

/** Total seconds a brief occupies, for anything that needs to plan around it. */
export function briefSeconds(stage: Stage, mission: DailyMission): number {
  const count =
    `Stage ${stage.n}`.split(/\s+/).length +
    stage.name.split(/\s+/).length +
    stage.objective.split(/\s+/).length +
    (mission.live ? 3 : 2);

  return (
    WORD_IN_STAGGER * (count - 1) +
    WORD_IN_SECONDS +
    HOLD_SECONDS +
    WORD_OUT_STAGGER * (count - 1) +
    WORD_OUT_SECONDS
  );
}
