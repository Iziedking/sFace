import { describe, expect, it } from 'vitest';

import {
  ATLAS_LAUNCH_ALLOCATION,
  allocateAtlasTrackRewards,
  closeAtlasDailyPool,
  calculateAtlasPeriodPool,
  rankAtlasRuns,
} from '../shared/atlas/rewards';

describe('NIM Atlas exact reward ledger', () => {
  it('accounts for exactly 50,000 NIM in safe integer Lunas', () => {
    expect(ATLAS_LAUNCH_ALLOCATION.totalLuna).toBe(5_000_000_000);
    expect(ATLAS_LAUNCH_ALLOCATION.dailyLuna).toBe(1_400_000_000);
    expect(ATLAS_LAUNCH_ALLOCATION.weekPoolsLuna).toEqual([750_000_000, 750_000_000, 750_000_000]);
    expect(ATLAS_LAUNCH_ALLOCATION.finaleLuna).toBe(1_350_000_000);
    expect(ATLAS_LAUNCH_ALLOCATION.dailyLuna + ATLAS_LAUNCH_ALLOCATION.weekPoolsLuna.reduce((sum, value) => sum + value, 0) + ATLAS_LAUNCH_ALLOCATION.finaleLuna).toBe(5_000_000_000);
  });

  it('uses floor arithmetic for daily shares and rolls dust honestly', () => {
    expect(closeAtlasDailyPool(0)).toEqual({ poolLuna: 50_000_000, eligibleCount: 0, perActorLuna: 0, awardedLuna: 0, dustLuna: 50_000_000, status: 'unawarded' });
    expect(closeAtlasDailyPool(3)).toEqual({ poolLuna: 50_000_000, eligibleCount: 3, perActorLuna: 16_666_666, awardedLuna: 49_999_998, dustLuna: 2, status: 'obligated' });
  });

  it('derives period pools and separate Explorer and Builder rank rewards', () => {
    expect(calculateAtlasPeriodPool('week-1')).toBe(750_000_000);
    expect(calculateAtlasPeriodPool('finale')).toBe(1_350_000_000);
    const runs = [
      { actorId: 'e1', walletAddress: 'NQE1', role: 'explorer' as const, score: 100, assistance: 'none' as const },
      { actorId: 'e2', walletAddress: 'NQE2', role: 'explorer' as const, score: 90, assistance: 'none' as const },
      { actorId: 'b1', walletAddress: 'NQB1', role: 'builder' as const, score: 100, assistance: 'none' as const },
      { actorId: 'b2', walletAddress: 'NQB2', role: 'builder' as const, score: 80, assistance: 'none' as const },
      { actorId: 'assisted', walletAddress: 'NQA', role: 'explorer' as const, score: 999, assistance: 'purchased-hint' as const },
    ];
    expect(rankAtlasRuns(runs).map((row) => [row.role, row.rank, row.actorId])).toEqual([['builder', 1, 'b1'], ['builder', 2, 'b2'], ['explorer', 1, 'e1'], ['explorer', 2, 'e2']]);
    expect(allocateAtlasTrackRewards('week-1', 'explorer', rankAtlasRuns(runs))).toMatchObject({ poolLuna: 375_000_000, obligationsLuna: 300_000_000, remainderLuna: 75_000_000, rewards: [{ rank: 1, amountLuna: 187_500_000 }, { rank: 2, amountLuna: 112_500_000 }] });
  });

  it('does not invent winners and keeps tied rank allocation deterministic', () => {
    expect(allocateAtlasTrackRewards('week-2', 'builder', [])).toMatchObject({ obligationsLuna: 0, remainderLuna: 375_000_000, rewards: [] });
    const tied = [
      { actorId: 'a', walletAddress: 'NQA', role: 'builder' as const, rank: 1, score: 100, assistance: 'none' as const },
      { actorId: 'b', walletAddress: 'NQB', role: 'builder' as const, rank: 1, score: 100, assistance: 'none' as const },
      { actorId: 'c', walletAddress: 'NQC', role: 'builder' as const, rank: 3, score: 90, assistance: 'none' as const },
    ];
    expect(allocateAtlasTrackRewards('week-2', 'builder', tied).rewards).toEqual([
      { rank: 1, actorId: 'a', walletAddress: 'NQA', amountLuna: 150_000_000 },
      { rank: 1, actorId: 'b', walletAddress: 'NQB', amountLuna: 150_000_000 },
      { rank: 3, actorId: 'c', walletAddress: 'NQC', amountLuna: 75_000_000 },
    ]);
  });
});
