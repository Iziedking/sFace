import { describe, expect, it } from 'vitest';

import {
  ATLAS_LAUNCH_ALLOCATION,
  allocateAtlasTrackRewards,
  closeAtlasDailyPool,
  calculateAtlasPeriodPool,
  rankAtlasRuns,
} from '../shared/atlas/rewards';

describe('NIM Atlas exact reward ledger', () => {
  it('accounts for exactly 80,000 NIM in safe integer Lunas', () => {
    expect(ATLAS_LAUNCH_ALLOCATION.totalLuna).toBe(8_000_000_000);
    expect(ATLAS_LAUNCH_ALLOCATION.dailyLuna).toBe(2_240_000_000);
    expect(ATLAS_LAUNCH_ALLOCATION.weekPoolsLuna).toEqual([1_200_000_000, 1_200_000_000, 1_200_000_000]);
    expect(ATLAS_LAUNCH_ALLOCATION.finaleLuna).toBe(2_160_000_000);
    expect(ATLAS_LAUNCH_ALLOCATION.dailyLuna + ATLAS_LAUNCH_ALLOCATION.weekPoolsLuna.reduce((sum, value) => sum + value, 0) + ATLAS_LAUNCH_ALLOCATION.finaleLuna).toBe(8_000_000_000);
  });

  it('uses floor arithmetic for daily shares and rolls dust honestly', () => {
    expect(closeAtlasDailyPool(0)).toEqual({ poolLuna: 80_000_000, eligibleCount: 0, perActorLuna: 0, awardedLuna: 0, dustLuna: 80_000_000, status: 'unawarded' });
    expect(closeAtlasDailyPool(3)).toEqual({ poolLuna: 80_000_000, eligibleCount: 3, perActorLuna: 26_666_666, awardedLuna: 79_999_998, dustLuna: 2, status: 'obligated' });
  });

  it('derives period pools and separate Explorer and Builder rank rewards', () => {
    expect(calculateAtlasPeriodPool('week-1')).toBe(1_200_000_000);
    expect(calculateAtlasPeriodPool('finale')).toBe(2_160_000_000);
    const runs = [
      { actorId: 'e1', walletAddress: 'NQE1', role: 'explorer' as const, score: 100, assistance: 'none' as const },
      { actorId: 'e2', walletAddress: 'NQE2', role: 'explorer' as const, score: 90, assistance: 'none' as const },
      { actorId: 'b1', walletAddress: 'NQB1', role: 'builder' as const, score: 100, assistance: 'none' as const },
      { actorId: 'b2', walletAddress: 'NQB2', role: 'builder' as const, score: 80, assistance: 'none' as const },
      { actorId: 'assisted', walletAddress: 'NQA', role: 'explorer' as const, score: 999, assistance: 'purchased-hint' as const },
    ];
    expect(rankAtlasRuns(runs).map((row) => [row.role, row.rank, row.actorId])).toEqual([['builder', 1, 'b1'], ['builder', 2, 'b2'], ['explorer', 1, 'e1'], ['explorer', 2, 'e2']]);
    expect(allocateAtlasTrackRewards('week-1', 'explorer', rankAtlasRuns(runs))).toMatchObject({ poolLuna: 600_000_000, obligationsLuna: 480_000_000, remainderLuna: 120_000_000, rewards: [{ rank: 1, amountLuna: 300_000_000 }, { rank: 2, amountLuna: 180_000_000 }] });
  });

  it('does not invent winners and keeps tied rank allocation deterministic', () => {
    expect(allocateAtlasTrackRewards('week-2', 'builder', [])).toMatchObject({ obligationsLuna: 0, remainderLuna: 600_000_000, rewards: [] });
    const tied = [
      { actorId: 'a', walletAddress: 'NQA', role: 'builder' as const, rank: 1, score: 100, assistance: 'none' as const },
      { actorId: 'b', walletAddress: 'NQB', role: 'builder' as const, rank: 1, score: 100, assistance: 'none' as const },
      { actorId: 'c', walletAddress: 'NQC', role: 'builder' as const, rank: 3, score: 90, assistance: 'none' as const },
    ];
    expect(allocateAtlasTrackRewards('week-2', 'builder', tied).rewards).toEqual([
      { rank: 1, actorId: 'a', walletAddress: 'NQA', amountLuna: 240_000_000 },
      { rank: 1, actorId: 'b', walletAddress: 'NQB', amountLuna: 240_000_000 },
      { rank: 3, actorId: 'c', walletAddress: 'NQC', amountLuna: 120_000_000 },
    ]);
  });
});
