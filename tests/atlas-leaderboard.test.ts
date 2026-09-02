import { describe, expect, it } from 'vitest';

import { createAtlasLeaderboardService } from '../server/atlas/leaderboard';

describe('NIM Atlas server leaderboard', () => {
  it('keeps best verified Explorer and Builder runs separate', async () => {
    const leaderboard = createAtlasLeaderboardService();
    await leaderboard.accept({ runId: 'e-1', actorId: 'actor-e', walletAddress: 'NQE', role: 'explorer', seasonId: 'season-1', score: 80, assistance: 'none', prizeEligible: true, replayHash: 'a'.repeat(64) });
    await leaderboard.accept({ runId: 'e-2', actorId: 'actor-e', walletAddress: 'NQE', role: 'explorer', seasonId: 'season-1', score: 70, assistance: 'none', prizeEligible: true, replayHash: 'b'.repeat(64) });
    await leaderboard.accept({ runId: 'b-1', actorId: 'actor-b', walletAddress: 'NQB', role: 'builder', seasonId: 'season-1', score: 60, assistance: 'none', prizeEligible: true, replayHash: 'c'.repeat(64) });
    await expect(leaderboard.accept({ runId: 'assisted', actorId: 'actor-a', walletAddress: 'NQA', role: 'explorer', seasonId: 'season-1', score: 999, assistance: 'purchased-hint', prizeEligible: false, replayHash: 'd'.repeat(64) })).rejects.toThrow(/assisted/i);

    await expect(leaderboard.list('season-1', 'explorer')).resolves.toMatchObject([{ actorId: 'actor-e', score: 80, rank: 1 }]);
    await expect(leaderboard.list('season-1', 'builder')).resolves.toMatchObject([{ actorId: 'actor-b', score: 60, rank: 1 }]);
  });

  it('rejects wallet substitution and same-season wallet reuse', async () => {
    const leaderboard = createAtlasLeaderboardService();
    const run = { runId: 'run-1', actorId: 'actor-1', walletAddress: 'NQ1', role: 'explorer' as const, seasonId: 'season-1', score: 1, assistance: 'none' as const, prizeEligible: true, replayHash: 'a'.repeat(64) };
    await leaderboard.accept(run);
    await expect(leaderboard.accept({ ...run, runId: 'run-2', walletAddress: 'NQ2' })).rejects.toThrow(/wallet/i);
    await expect(leaderboard.accept({ ...run, runId: 'run-3', actorId: 'actor-2' })).rejects.toThrow(/wallet/i);
  });

  it('ranks by verified mastery when a breakdown is present and rejects forged components', async () => {
    const leaderboard = createAtlasLeaderboardService();
    await leaderboard.accept({ runId: 'mastery-low', actorId: 'actor-low', walletAddress: 'NQL', role: 'explorer', seasonId: 'season-2', score: 999, assistance: 'none', prizeEligible: true, replayHash: 'a'.repeat(64), mastery: { knowledge: 4_000, execution: 0, safety: 1_500, efficiency: 1_500, total: 7_000 } });
    await leaderboard.accept({ runId: 'mastery-high', actorId: 'actor-high', walletAddress: 'NQH', role: 'explorer', seasonId: 'season-2', score: 1, assistance: 'none', prizeEligible: true, replayHash: 'b'.repeat(64), mastery: { knowledge: 4_000, execution: 3_000, safety: 1_500, efficiency: 1_500, total: 10_000 } });
    await expect(leaderboard.list('season-2', 'explorer')).resolves.toMatchObject([{ runId: 'mastery-high', rank: 1 }, { runId: 'mastery-low', rank: 2 }]);
    await expect(leaderboard.accept({ runId: 'forged-mastery', actorId: 'actor-forged', walletAddress: 'NQF', role: 'explorer', seasonId: 'season-2', score: 1, assistance: 'none', prizeEligible: true, replayHash: 'c'.repeat(64), mastery: { knowledge: 4_000, execution: 3_000, safety: 1_500, efficiency: 1_500, total: 2 } })).rejects.toThrow(/mastery/i);
  });
});
