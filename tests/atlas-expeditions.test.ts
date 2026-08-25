import { describe, expect, it } from 'vitest';

import { rankAtlasRuns } from '../shared/atlas/rewards';

describe('NIM Atlas expedition leaderboard inputs', () => {
  it('keeps Explorer and Builder expedition scores separate and excludes assisted runs', () => {
    const ranked = rankAtlasRuns([
      { actorId: 'explorer-1', walletAddress: 'NQE1', role: 'explorer', score: 80, assistance: 'none' },
      { actorId: 'builder-1', walletAddress: 'NQB1', role: 'builder', score: 70, assistance: 'none' },
      { actorId: 'assisted-explorer', walletAddress: 'NQE2', role: 'explorer', score: 999, assistance: 'purchased-hint' },
    ]);

    expect(ranked.map(({ role, actorId, rank }) => ({ role, actorId, rank }))).toEqual([
      { role: 'builder', actorId: 'builder-1', rank: 1 },
      { role: 'explorer', actorId: 'explorer-1', rank: 1 },
    ]);
  });
});
