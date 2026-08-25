import { describe, expect, it } from 'vitest';

import {
  SEASON_0_TOTAL_LUNA,
  allocateRelayPeriodRewards,
  calculateRelayPeriodAllocation,
  type RelayRewardRun,
} from '../shared/relay/rewards';

function run(walletAddress: string, actorId: string, day: string, score: number): RelayRewardRun {
  return { walletAddress, actorId, missionDate: day, score, bankedNodes: 1, bestChain: 1, damageTaken: 0, integrityRemaining: 3 };
}

describe('Season 0 reward math', () => {
  it('derives the approved 80,000 NIM allocation exactly in Lunas', () => {
    expect(SEASON_0_TOTAL_LUNA).toBe(8_000_000_000);
    expect(calculateRelayPeriodAllocation('week-1')).toEqual({ period: 'week-1', poolLuna: 1_600_000_000, remainderLuna: 0 });
    expect(calculateRelayPeriodAllocation('finale')).toEqual({ period: 'finale', poolLuna: 3_200_000_000, remainderLuna: 0 });
  });

  it('requires four weekly or twelve finale days and pays top three 50/30/20', () => {
    const weekly = ['wallet-a', 'wallet-b', 'wallet-c'].flatMap((wallet, walletIndex) => Array.from({ length: 4 }, (_, index) => run(wallet, `actor-${walletIndex}`, `2026-08-0${index + 1}`, 100 - walletIndex * 10 - index)));
    const result = allocateRelayPeriodRewards('week-1', weekly);
    expect(result.rewards.map((reward) => reward.amountLuna)).toEqual([800_000_000, 480_000_000, 320_000_000]);
    expect(result.remainderLuna).toBe(0);
    expect(result.eligibleWallets).toBe(3);
  });

  it('requires all twelve finale days before creating an obligation', () => {
    const eleven = Array.from({ length: 11 }, (_, index) => run('wallet-final', 'actor-final', `2026-08-${String(index + 1).padStart(2, '0')}`, 100));
    expect(allocateRelayPeriodRewards('finale', eleven).rewards).toEqual([]);
    const twelve = [...eleven, run('wallet-final', 'actor-final', '2026-08-12', 100)];
    expect(allocateRelayPeriodRewards('finale', twelve).rewards[0]).toMatchObject({ amountLuna: 1_600_000_000 });
  });

  it('aggregates best days, deduplicates wallets, and discloses tie division', () => {
    const runs = [
      ...Array.from({ length: 4 }, (_, index) => run('wallet-a', 'actor-a', `2026-08-0${index + 1}`, 100 + index)),
      ...Array.from({ length: 4 }, (_, index) => run('wallet-b', 'actor-b', `2026-08-1${index + 1}`, 100 + index)),
      ...Array.from({ length: 4 }, (_, index) => run('wallet-c', 'actor-c', `2026-08-2${index + 1}`, 90 + index)),
      run('wallet-a', 'actor-other', '2026-08-01', 1),
    ];
    const result = allocateRelayPeriodRewards('week-1', runs);
    expect(result.rewards.slice(0, 2).every((reward) => reward.amountLuna === 640_000_000)).toBe(true);
    expect(result.rewards).toHaveLength(3);
    expect(result.obligationsLuna + result.remainderLuna).toBe(result.poolLuna);
  });

  it('rejects unsafe, decimal, negative, and over-budget amounts', () => {
    expect(() => allocateRelayPeriodRewards('week-1', [run('wallet', 'actor', '2026-08-01', 1)], { totalLuna: 1.5 })).toThrow();
    expect(() => allocateRelayPeriodRewards('week-1', [], { totalLuna: -1 })).toThrow();
    expect(() => allocateRelayPeriodRewards('week-1', [], { totalLuna: Number.MAX_SAFE_INTEGER + 1 })).toThrow();
  });
});
