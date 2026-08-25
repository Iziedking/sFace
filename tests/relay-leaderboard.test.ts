import { describe, expect, it } from 'vitest';

import { createRelayLeaderboardService, maskRelayAddress } from '../server/relay/leaderboard';

describe('Relay public leaderboard', () => {
  it('ranks by the locked tuple and shares exact ties', async () => {
    const service = createRelayLeaderboardService({
      runs: async () => [
        { id: 'r3', actorId: 'c', missionDate: '2026-08-24', walletAddress: 'NQ03 CCCC CCCC CCCC CCCC CCCC CCCC CCCC CCCC', result: { score: 90, bankedNodes: 3, bestChain: 2, damageTaken: 0, integrityRemaining: 3 } },
        { id: 'r1', actorId: 'a', missionDate: '2026-08-24', walletAddress: 'NQ01 AAAA AAAA AAAA AAAA AAAA AAAA AAAA AAAA', result: { score: 100, bankedNodes: 2, bestChain: 1, damageTaken: 0, integrityRemaining: 3 } },
        { id: 'r2', actorId: 'b', missionDate: '2026-08-24', walletAddress: 'NQ02 BBBB BBBB BBBB BBBB BBBB BBBB BBBB BBBB', result: { score: 100, bankedNodes: 2, bestChain: 1, damageTaken: 0, integrityRemaining: 3 } },
      ],
    });
    const rows = await service.daily('2026-08-24');
    expect(rows.map((row) => [row.actorId, row.rank])).toEqual([['a', 1], ['b', 1], ['c', 3]]);
    expect(rows[0]).not.toHaveProperty('walletAddress');
    expect(rows[0]?.wallet).toBe(maskRelayAddress('NQ01 AAAA AAAA AAAA AAAA AAAA AAAA AAAA AAAA'));
  });

  it('uses a stable masked representation', () => {
    expect(maskRelayAddress('NQ31 BDN3 15K1 RP6Q MC3B GHNV 8THQ QS3C MLKK')).toBe('NQ31…MLKK');
    expect(maskRelayAddress('')).toBe('unknown');
  });
});
