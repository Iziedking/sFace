import { describe, expect, it } from 'vitest';
import { shortAddress, winnerAddressOf } from '../src/ui/app-helpers';

describe('app presentation helpers', () => {
  it('shortens wallet addresses without losing recognition blocks', () => {
    expect(shortAddress(null)).toBeNull();
    expect(shortAddress('NQ12 3456')).toBe('NQ12 3456');
    expect(shortAddress('NQ12 3456 7890 ABCD')).toBe('NQ12 3456 ... ABCD');
  });

  it('hides the winner address from the winning player', () => {
    const challenge = { creatorId: 'a', creatorAddress: 'creator', creatorScore: 10, opponentId: 'b', opponentAddress: 'opponent', opponentScore: 8 } as never;
    expect(winnerAddressOf(challenge, 'a')).toBeNull();
    expect(winnerAddressOf(challenge, 'b')).toBe('creator');
  });
});
