import { describe, expect, it } from 'vitest';
import { scoreClaimMessage } from '../src/data/score-claim';

describe('score claim message', () => {
  it('binds date, seed, stage, and score in the canonical format', () => {
    expect(scoreClaimMessage({ date: '2026-08-11', seed: 'seed-a', stage: 3, score: 420 })).toBe('sface:2026-08-11:seed-a:s3:420');
  });
});
