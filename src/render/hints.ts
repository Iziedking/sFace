/**
 * A line of help, occasionally, while you are playing.
 *
 * The brief before a stage says what the stage is. It is also read once, before
 * anybody has touched the thing it is describing, which is the worst possible
 * moment to explain a mechanic. The rule that matters on stage four is that a
 * sight cone wakes the level, and you learn that by walking into one and losing
 * the run rather than by having read a sentence ninety seconds earlier.
 *
 * So the rules that cost a run get said again, in the run, near the point they
 * start to matter.
 *
 * ## Stage four and up, on purpose
 *
 * One to three are the same game with a tighter clock: fly, free people, reach
 * the pad. There is nothing to explain that the first thirty seconds do not
 * explain better. From four onward every stage introduces a rule the earlier
 * ones did not have, and each of those rules is a way to lose without
 * understanding why.
 *
 * ## Why this is not in game/
 *
 * It is presentation. Nothing here changes the simulation, and game/ stays
 * DOM-free and deterministic so server/verify.ts can rebuild a level from a
 * seed. A hint schedule that varied with wall-clock time inside the sim would
 * make two players on one seed run different levels.
 */

import type { RunState } from '../game/state';

/**
 * What each stage is likely to kill you with.
 *
 * Written as the rule, not as encouragement. "Sight cones wake the level" is
 * something to act on; "be careful out there" is noise on top of a fight.
 */
const HINTS: Record<number, readonly string[]> = {
  /*
   * The early stages taught nothing, and there was one thing to teach.
   *
   * Pale figures fly alongside you from the first run: other people's recorded
   * runs on the same seed, and occasionally somebody playing right now. Asked
   * directly who they were and why they were blurred, which is a fair question
   * about something the game never mentions and puts on screen constantly.
   */
  1: [
    'THE FADED PILOTS ARE OTHER RUNS ON TODAY\'S SEED. THEY CANNOT HELP OR HURT YOU',
  ],
  4: [
    'SIGHT CONES WAKE THE LEVEL. CROSS ONE AND EVERYONE STARTS WALKING AT YOU',
    'AN ATTACKER THAT HAS NOT SEEN YOU CAN BE WALKED AROUND',
  ],
  5: [
    'THE CAR IS TWICE AS FAST AND HEARD FROM TWICE AS FAR',
    'A DOORWAY FITS A PERSON, NOT THE CAR. GET OUT TO GO INSIDE',
    'DRIVING THROUGH SOMEBODY AT SPEED HURTS THEM. TWICE PUTS THEM DOWN',
  ],
  6: [
    'FOUR POSTS AT EACH PANEL. ONE OF THEM EXPLAINS TODAY',
    'A WRONG ANSWER WAKES THE STREET. READING COSTS NOTHING',
    'THE EXIT WILL NOT OPEN UNTIL EVERY PANEL IS READ',
  ],
  /*
   * Stage seven explains a verb no other stage uses, so its hints spell out the
   * loop in order rather than listing rules.
   *
   * It was three true statements that assumed you had already worked out what
   * the plates with tickers on them were for. Reported as clearing the stage
   * without knowing what the BTC and ETH part had been about, which is the
   * clearest possible signal that the mechanic was never explained: the player
   * answered four gates correctly and still could not say what they had done.
   */
  7: [
    'THE PLATES WITH TICKERS ARE REAL PROJECTS. FLY TO ONE AND IT TELLS YOU ITS 24H MOVE',
    'EACH GATE ASKS WHICH OF FOUR HELD UP BEST TODAY, OR WHICH FELL WITH THE WRECK',
    'A PROJECT YOU VISITED SHOWS ITS MOVE ON THE GATE CARD. ONE YOU SKIPPED SHOWS NOTHING',
    'NO WEAPON OPENS A GATE. THE ANSWER IS THE KEY',
  ],
};

/** Nothing for the first stretch: the run explains itself better than a line. */
const FIRST_AT = 18;
/** Gap between them, long enough that they read as occasional, not as a feed. */
const EVERY = 34;
/** How long one stays up. Long enough to read at a glance while moving. */
const SHOWN_FOR = 6.5;

export interface Hint {
  text: string;
  /** 0 to 1, for the fade at each end. */
  alpha: number;
}

/**
 * Which hint is on screen, if any.
 *
 * Driven off `state.time` rather than a wall clock, so a paused run does not
 * burn through its hints and a resumed one picks up where it was. That falls
 * out for free from the run's own clock being the only input.
 */
export function hintFor(state: RunState): Hint | null {
  const lines = HINTS[state.stage.n];
  if (!lines || lines.length === 0) return null;

  /*
   * Never over something else that is written on the screen.
   *
   * A node card, a gate question and an alarm all draw in the same band, and
   * all three are things the player has to read right now. A hint is the least
   * important text in the game and it gives way to every one of them rather
   * than being drawn on top and making both unreadable.
   */
  if (state.openNodeId !== null || state.openGateId !== null) return null;
  if (state.alert > 0.01 || state.time < state.alertedUntil) return null;
  if (state.finished) return null;
  /*
   * And never underneath the tour.
   *
   * core/tour.ts teaches the same stage rules on a first run, in the same band
   * of the screen, at the moment the thing is in front of the player. Two
   * systems explaining the sight cones at once is worse than either alone, and
   * the tour is the one that knows whether this player has seen any of it.
   */
  if (state.tutored) return null;

  const since = state.time - FIRST_AT;
  if (since < 0) return null;

  const slot = Math.floor(since / EVERY);
  if (slot >= lines.length) return null;

  const into = since - slot * EVERY;
  if (into > SHOWN_FOR) return null;

  const text = lines[slot];
  if (!text) return null;

  // Half a second in and out. Anything sharper reads as a glitch on a screen
  // where nothing else appears instantly.
  const fade = 0.5;
  const alpha =
    into < fade ? into / fade : into > SHOWN_FOR - fade ? (SHOWN_FOR - into) / fade : 1;

  return { text, alpha: Math.max(0, Math.min(1, alpha)) };
}
