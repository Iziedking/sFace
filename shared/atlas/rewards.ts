import type { AtlasAssistance, AtlasRole } from './types';

export type AtlasRewardPeriod = 'week-1' | 'week-2' | 'week-3' | 'finale';

export interface AtlasRewardRun {
  actorId: string;
  walletAddress: string;
  role: AtlasRole;
  score: number;
  assistance: AtlasAssistance;
}

export interface AtlasRankedRun extends AtlasRewardRun {
  rank: number;
}

export interface AtlasDailyPoolClose {
  poolLuna: number;
  eligibleCount: number;
  perActorLuna: number;
  awardedLuna: number;
  dustLuna: number;
  status: 'unawarded' | 'obligated';
}

export interface AtlasTrackReward {
  rank: number;
  actorId: string;
  walletAddress: string;
  amountLuna: number;
}

export interface AtlasTrackRewardAllocation {
  period: AtlasRewardPeriod;
  role: AtlasRole;
  poolLuna: number;
  rewards: AtlasTrackReward[];
  obligationsLuna: number;
  remainderLuna: number;
}

export const ATLAS_LAUNCH_ALLOCATION = {
  totalLuna: 8_000_000_000,
  dailyLuna: 2_240_000_000,
  dailyPoolLuna: 80_000_000,
  weekPoolsLuna: [1_200_000_000, 1_200_000_000, 1_200_000_000] as const,
  finaleLuna: 2_160_000_000,
} as const;

const TRACK_PERCENTAGES_BPS = [5_000, 3_000, 2_000] as const;
const ROLE_ORDER: Record<AtlasRole, number> = { builder: 0, explorer: 1 };

export function closeAtlasDailyPool(eligibleCount: number): AtlasDailyPoolClose {
  assertSafeInteger(eligibleCount, 'Eligible count');
  if (eligibleCount < 0) throw new Error('Eligible count cannot be negative.');
  if (eligibleCount === 0) {
    return {
      poolLuna: ATLAS_LAUNCH_ALLOCATION.dailyPoolLuna,
      eligibleCount,
      perActorLuna: 0,
      awardedLuna: 0,
      dustLuna: ATLAS_LAUNCH_ALLOCATION.dailyPoolLuna,
      status: 'unawarded',
    };
  }

  const perActorLuna = Math.floor(ATLAS_LAUNCH_ALLOCATION.dailyPoolLuna / eligibleCount);
  const awardedLuna = perActorLuna * eligibleCount;
  return {
    poolLuna: ATLAS_LAUNCH_ALLOCATION.dailyPoolLuna,
    eligibleCount,
    perActorLuna,
    awardedLuna,
    dustLuna: ATLAS_LAUNCH_ALLOCATION.dailyPoolLuna - awardedLuna,
    status: 'obligated',
  };
}

export function calculateAtlasPeriodPool(period: AtlasRewardPeriod): number {
  if (period === 'finale') return ATLAS_LAUNCH_ALLOCATION.finaleLuna;
  return ATLAS_LAUNCH_ALLOCATION.weekPoolsLuna[Number(period.slice(-1)) - 1] ?? 0;
}

export function rankAtlasRuns(runs: readonly AtlasRewardRun[]): AtlasRankedRun[] {
  const eligible = runs
    .filter((run) => run.assistance === 'none')
    .map((run) => ({ ...run, walletAddress: run.walletAddress.trim() }));
  for (const run of eligible) {
    if (!run.actorId || !run.walletAddress || !Number.isSafeInteger(run.score) || run.score < 0) {
      throw new Error('Reward run has invalid identity or score.');
    }
  }

  const bestBySubmission = new Map<string, AtlasRewardRun>();
  for (const run of eligible) {
    const key = `${run.role}:${run.actorId}:${run.walletAddress}`;
    const current = bestBySubmission.get(key);
    if (!current || run.score > current.score) bestBySubmission.set(key, run);
  }

  const sorted = [...bestBySubmission.values()].sort((left, right) => {
    return ROLE_ORDER[left.role] - ROLE_ORDER[right.role]
      || right.score - left.score
      || left.actorId.localeCompare(right.actorId)
      || left.walletAddress.localeCompare(right.walletAddress);
  });

  let previousRole: AtlasRole | undefined;
  let previousScore: number | undefined;
  let rolePosition = 0;
  return sorted.map((run) => {
    if (run.role !== previousRole) {
      previousRole = run.role;
      previousScore = undefined;
      rolePosition = 0;
    }
    rolePosition += 1;
    const rank = previousScore === run.score ? rolePosition - 1 : rolePosition;
    previousScore = run.score;
    return { ...run, rank };
  });
}

export function allocateAtlasTrackRewards(
  period: AtlasRewardPeriod,
  role: AtlasRole,
  rankedRuns: readonly AtlasRankedRun[],
): AtlasTrackRewardAllocation {
  const poolLuna = Math.floor(calculateAtlasPeriodPool(period) / 2);
  const winners = rankedRuns
    .filter((run) => run.role === role && run.rank <= TRACK_PERCENTAGES_BPS.length && run.assistance === 'none')
    .sort((left, right) => left.rank - right.rank || left.actorId.localeCompare(right.actorId) || left.walletAddress.localeCompare(right.walletAddress));

  const rewards: AtlasTrackReward[] = [];
  let obligationsLuna = 0;
  let index = 0;
  while (index < winners.length) {
    const rank = winners[index].rank;
    const group = winners.filter((winner) => winner.rank === rank);
    const firstSlot = Math.max(1, rank);
    const lastSlot = Math.min(TRACK_PERCENTAGES_BPS.length, firstSlot + group.length - 1);
    const groupBps = TRACK_PERCENTAGES_BPS.slice(firstSlot - 1, lastSlot).reduce((sum, value) => sum + value, 0);
    const groupAmount = Math.floor(poolLuna * groupBps / 10_000);
    const split = largestRemainderSplit(groupAmount, group.length);
    group.forEach((winner, groupIndex) => {
      const amountLuna = split[groupIndex] ?? 0;
      rewards.push({ rank, actorId: winner.actorId, walletAddress: winner.walletAddress, amountLuna });
      obligationsLuna += amountLuna;
    });
    index += group.length;
  }

  return {
    period,
    role,
    poolLuna,
    rewards,
    obligationsLuna,
    remainderLuna: poolLuna - obligationsLuna,
  };
}

function largestRemainderSplit(total: number, count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(total / count);
  const remainder = total - base * count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

function assertSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) throw new Error(`${label} must be a safe integer.`);
}
