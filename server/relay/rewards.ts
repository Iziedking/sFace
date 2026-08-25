import { allocateRelayPeriodRewards, calculateRelayPeriodAllocation, SEASON_0_TOTAL_LUNA, type RelayPeriodRewards, type RelayRewardPeriod, type RelayRewardRun } from '../../shared/relay/rewards';
import type { RelaySnapshot, RelayStore } from './store';
import { maskRelayAddress } from './leaderboard';

export interface RelayRewardObligation {
  id: string;
  period: RelayRewardPeriod;
  walletAddress: string;
  amountLuna: number;
  rank: number;
  qualifyingDays: number;
  aggregateScore: number;
  status: 'scheduled' | 'approved' | 'submitted' | 'confirming' | 'verified' | 'unknown' | 'failed';
}

export interface RelayPublicReward {
  id: string;
  period: RelayRewardPeriod;
  wallet: string;
  amountLuna: number;
  status: RelayRewardObligation['status'];
}

export interface RelayRewardService {
  createObligations(period: RelayRewardPeriod, runs: readonly RelayRewardRun[]): Promise<RelayPeriodRewards>;
  publicRecords(): Promise<RelayPublicReward[]>;
}

export function createRelayRewardService(options: { store: RelayStore; fundedAllocationLuna?: number }): RelayRewardService {
  const fundedAllocationLuna = options.fundedAllocationLuna ?? SEASON_0_TOTAL_LUNA;
  let snapshot: RelaySnapshot | null = null;
  let operations: Promise<void> = Promise.resolve();
  const ensure = async (): Promise<RelaySnapshot> => { if (!snapshot) snapshot = await options.store.load(); return snapshot; };
  const serialise = (operation: () => Promise<void>): Promise<void> => { operations = operations.catch(() => undefined).then(operation); return operations; };
  return {
    async createObligations(period, runs) {
      const summary = allocateRelayPeriodRewards(period, runs, { totalLuna: fundedAllocationLuna, treasuryAllocationLuna: fundedAllocationLuna });
      const expected = calculateRelayPeriodAllocation(period, fundedAllocationLuna);
      if (summary.obligationsLuna + summary.remainderLuna !== expected.poolLuna + expected.remainderLuna) throw new Error('relay_reward_conservation_failed');
      await serialise(async () => {
        const current = await ensure();
        const next = structuredClone(current);
        for (const reward of summary.rewards) {
          const id = `${period}:${reward.walletAddress}`;
          const existing = next.rewardObligations[id];
          if (existing && JSON.stringify(existing) !== JSON.stringify({ ...reward, id, status: 'scheduled' })) throw new Error('relay_reward_obligation_conflict');
          next.rewardObligations[id] = { ...reward, id, status: 'scheduled' };
        }
        await options.store.commit('rewards.obligations.created', next);
        snapshot = next;
      });
      return summary;
    },
    async publicRecords() {
      const current = await ensure();
      return Object.values(current.rewardObligations).map((value) => value as unknown as RelayRewardObligation).filter((value) => value.status !== 'failed').map((value) => ({ id: value.id, period: value.period, wallet: maskRelayAddress(value.walletAddress), amountLuna: value.amountLuna, status: value.status }));
    },
  };
}
