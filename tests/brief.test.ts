/**
 * The stage brief.
 *
 * The run is held while it is up, so its length is not a style choice: every
 * second is a second the player is watching instead of playing. The ceiling is
 * the thing worth pinning, because the natural pace grows with the stage's name
 * and objective, and a longer stage would otherwise quietly hold the game for
 * longer than anybody agreed to.
 */

import { describe, expect, it } from 'vitest';

import { briefSeconds } from '../src/ui/brief';
import { STAGES, stageAt } from '../src/data/campaign';
import { practiceMission } from '../src/game/mission';

const LIVE = { ...practiceMission('2026-07-30'), live: true, ticker: 'MEME', changePct: -16.3 };
const PRACTICE = practiceMission('2026-07-30');

describe('how long the game is held', () => {
  it('never holds a run longer than five seconds, on any stage', () => {
    for (let n = 1; n <= STAGES.length; n++) {
      for (const mission of [LIVE, PRACTICE]) {
        expect(briefSeconds(stageAt(n), mission)).toBeLessThanOrEqual(5);
      }
    }
  });

  it('is still long enough to read', () => {
    // A ceiling that collapsed to nothing would technically pass the test above
    // while making the card useless.
    for (let n = 1; n <= STAGES.length; n++) {
      expect(briefSeconds(stageAt(n), LIVE)).toBeGreaterThan(2.5);
    }
  });

  it('does not pad a short brief out to the ceiling', () => {
    // Compression only kicks in when the natural pace would overrun. A terse
    // stage should be quicker than a wordy one, not the same length.
    const shortest = Math.min(...STAGES.map((s) => briefSeconds(s, LIVE)));
    const longest = Math.max(...STAGES.map((s) => briefSeconds(s, LIVE)));
    expect(shortest).toBeLessThan(longest);
  });
});
