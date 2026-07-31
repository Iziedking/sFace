/**
 * In-run hints, and the rule that they are the least important text on screen.
 *
 * A brief is read once, before anybody has touched the thing it describes,
 * which is the worst moment to explain a mechanic. The rule that matters on
 * stage four is that a sight cone wakes the level, and that gets learned by
 * walking into one, not by having read a sentence ninety seconds earlier.
 *
 * The constraint these mostly cover is that a hint must never be drawn over
 * something the player has to read right now. A node card, a gate question and
 * an alarm all occupy the same band, and all three are urgent in a way a hint
 * is not.
 */

import { describe, expect, it } from 'vitest';

import { practiceMission } from '../src/game/mission';
import { RunState } from '../src/game/state';
import { hintFor } from '../src/render/hints';

const MISSION = practiceMission('2026-07-31');

function atStage(n: number, time: number): RunState {
  const state = new RunState(MISSION, 'sidearm', n);
  state.time = time;
  return state;
}

/** The first moment a hint is up, found rather than assumed. */
function firstHintTime(state: RunState): number | null {
  for (let t = 0; t < 300; t += 0.25) {
    state.time = t;
    if (hintFor(state)) return t;
  }
  return null;
}

describe('which stages get them', () => {
  it('says nothing on the stages that explain themselves', () => {
    /*
     * One to three are the same game with a tighter clock. There is no rule
     * there that the first thirty seconds do not teach better than a line of
     * text sitting over the level.
     */
    for (const n of [1, 2, 3]) {
      expect(firstHintTime(atStage(n, 0))).toBeNull();
    }
  });

  it('has something for every stage from four up', () => {
    // Each of these introduces a rule the earlier ones did not have, and every
    // one of those rules is a way to lose without understanding why.
    for (const n of [4, 5, 6, 7]) {
      expect(firstHintTime(atStage(n, 0))).not.toBeNull();
    }
  });
});

describe('they give way to anything else written on screen', () => {
  it('stands down while a node card is open', () => {
    const state = atStage(6, 0);
    const at = firstHintTime(state)!;

    state.time = at;
    expect(hintFor(state)).not.toBeNull();

    // The card lands in the same band, and it is the thing being answered.
    state.openNodeId = 1;
    expect(hintFor(state)).toBeNull();
  });

  it('stands down while a gate is asking', () => {
    const state = atStage(7, 0);
    const at = firstHintTime(state)!;

    state.time = at;
    expect(hintFor(state)).not.toBeNull();

    state.openGateId = 1;
    expect(hintFor(state)).toBeNull();
  });

  it('stands down during an alarm', () => {
    // An alarm is the one moment the player has least attention to spare.
    const state = atStage(4, 0);
    const at = firstHintTime(state)!;

    state.time = at;
    expect(hintFor(state)).not.toBeNull();

    state.alert = 1;
    expect(hintFor(state)).toBeNull();
  });

  it('stands down once the run is over', () => {
    const state = atStage(5, 0);
    const at = firstHintTime(state)!;

    state.time = at;
    expect(hintFor(state)).not.toBeNull();

    state.phase = 'extracted';
    expect(hintFor(state)).toBeNull();
  });
});

describe('how often they appear', () => {
  it('waits before the first one', () => {
    // The opening seconds are the player working out where they are. A line of
    // text over that is noise before it is help.
    const state = atStage(4, 0);
    expect(firstHintTime(state)).toBeGreaterThan(10);
  });

  it('shows one at a time and not for long', () => {
    const state = atStage(7, 0);
    let showing = 0;

    for (let t = 0; t < 250; t += 0.5) {
      state.time = t;
      if (hintFor(state)) showing += 0.5;
    }

    // A handful of short appearances across a whole run, not a running feed.
    expect(showing).toBeGreaterThan(0);
    expect(showing).toBeLessThan(40);
  });

  it('never repeats a line inside one run', () => {
    // Being told the same thing twice reads as the game not noticing you.
    const state = atStage(6, 0);
    const seen: string[] = [];

    for (let t = 0; t < 250; t += 0.25) {
      state.time = t;
      const hint = hintFor(state);
      if (hint && seen[seen.length - 1] !== hint.text) seen.push(hint.text);
    }

    expect(new Set(seen).size).toBe(seen.length);
  });

  it('fades in and out rather than snapping', () => {
    // Nothing else on this screen appears instantly, and a hint that does reads
    // as a glitch.
    const state = atStage(4, 0);
    const at = firstHintTime(state)!;

    state.time = at;
    const first = hintFor(state)!;
    expect(first.alpha).toBeLessThan(1);
    expect(first.alpha).toBeGreaterThanOrEqual(0);

    state.time = at + 2;
    expect(hintFor(state)?.alpha).toBe(1);
  });
});
