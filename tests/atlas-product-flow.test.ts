import { describe, expect, it } from 'vitest';

import { ATLAS_EVERGREEN_ADVENTURES } from '../shared/atlas/adventures/evergreen';
import { selectDailyChallenge, dailyChallengeChoices, dailyRetryHint, evergreenTeachBackChoices } from '../src/atlas/product-model';

describe('NIM Atlas product flow', () => {
  it('serves the real UTC daily challenge and keeps the evergreen rotation alive after launch', () => {
    expect(selectDailyChallenge(new Date('2026-08-25T23:59:59.000Z')).day).toBe(1);
    expect(selectDailyChallenge(new Date('2026-08-26T00:00:00.000Z')).day).toBe(2);
    expect(selectDailyChallenge(new Date('2026-09-21T12:00:00.000Z')).day).toBe(28);
    expect(selectDailyChallenge(new Date('2026-09-22T12:00:00.000Z')).day).toBe(1);
  });

  it('gives every daily challenge three deterministic, unique choices including the answer', () => {
    for (let day = 1; day <= 28; day += 1) {
      const challenge = selectDailyChallenge(new Date(Date.UTC(2026, 7, 24 + day)));
      const first = dailyChallengeChoices(challenge);
      const second = dailyChallengeChoices(challenge);
      expect(first).toEqual(second);
      expect(first).toHaveLength(3);
      expect(new Set(first).size).toBe(3);
      expect(first).toContain(challenge.answer);
      expect(dailyRetryHint(challenge)).toMatch(/Knowledge Book/);
      if (challenge.theme !== 'money') expect(dailyRetryHint(challenge)).not.toMatch(/Luna conversion/);
    }
  });

  it('never presents an evergreen teach-back answer as the only possible action', () => {
    for (const adventure of ATLAS_EVERGREEN_ADVENTURES) {
      adventure.teachBack.forEach((answer, step) => {
        const choices = evergreenTeachBackChoices(adventure, step);
        expect(choices).toHaveLength(3);
        expect(new Set(choices).size).toBe(3);
        expect(choices).toContain(answer);
      });
    }
  });
});
