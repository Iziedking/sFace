export const LUNAS_PER_NIM = 100_000;
export const SEASON_0_TOTAL_NIM = 80_000;
export const SEASON_0_TOTAL_LUNA = SEASON_0_TOTAL_NIM * LUNAS_PER_NIM;

export type RelayRewardPeriod = 'week-1' | 'week-2' | 'week-3' | 'finale';

export interface RelayRewardRun {
  walletAddress: string;
  actorId: string;
  missionDate: string;
  score: number;
  bankedNodes: number;
  bestChain: number;
  damageTaken: number;
  integrityRemaining: number;
}

export interface RelayPeriodAllocation {
  period: RelayRewardPeriod;
  poolLuna: number;
  remainderLuna: number;
}

export interface RelayRewardObligation {
  period: RelayRewardPeriod;
  rank: number;
  walletAddress: string;
  amountLuna: number;
  qualifyingDays: number;
  aggregateScore: number;
}

export interface RelayPeriodRewards extends RelayPeriodAllocation {
  eligibleWallets: number;
  rewards: RelayRewardObligation[];
  obligationsLuna: number;
}

const PERIOD_PERCENT: Record<RelayRewardPeriod, number> = { 'week-1': 20, 'week-2': 20, 'week-3': 20, finale: 40 };
const PAYOUT_PERCENT = [50, 30, 20] as const;

export function calculateRelayPeriodAllocation(period: RelayRewardPeriod, totalLuna = SEASON_0_TOTAL_LUNA): RelayPeriodAllocation {
  if (!(period in PERIOD_PERCENT)) throw new Error('relay_invalid_reward_period');
  assertLunaAmount(totalLuna, SEASON_0_TOTAL_LUNA);
  const raw = totalLuna * PERIOD_PERCENT[period];
  if (!Number.isSafeInteger(raw)) throw new Error('relay_invalid_luna_amount');
  const poolLuna = Math.floor(raw / 100);
  return { period, poolLuna, remainderLuna: raw % 100 };
}

export function allocateRelayPeriodRewards(period: RelayRewardPeriod, runs: readonly RelayRewardRun[], options: { totalLuna?: number; treasuryAllocationLuna?: number } = {}): RelayPeriodRewards {
  const totalLuna = options.totalLuna ?? SEASON_0_TOTAL_LUNA;
  const treasuryAllocationLuna = options.treasuryAllocationLuna ?? SEASON_0_TOTAL_LUNA;
  assertLunaAmount(totalLuna, treasuryAllocationLuna);
  const allocation = calculateRelayPeriodAllocation(period, totalLuna);
  const requiredDays = period === 'finale' ? 12 : 4;
  const aggregated = new Map<string, Aggregate>();
  for (const run of runs) {
    validateRun(run);
    const walletAddress = normaliseWallet(run.walletAddress);
    const existing = aggregated.get(walletAddress) ?? { walletAddress, days: new Map<string, RelayRewardRun>() };
    const current = existing.days.get(run.missionDate);
    if (!current || compareRun(run, current) < 0) existing.days.set(run.missionDate, run);
    aggregated.set(walletAddress, existing);
  }
  const eligible = [...aggregated.values()]
    .filter((candidate) => candidate.days.size >= requiredDays)
    .map((candidate) => toAggregateResult(candidate, requiredDays))
    .sort(compareAggregate);
  const rewards: RelayRewardObligation[] = [];
  let remainderLuna = allocation.remainderLuna;
  let index = 0;
  while (index < Math.min(eligible.length, PAYOUT_PERCENT.length)) {
    const first = eligible[index]!;
    let end = index + 1;
    while (end < eligible.length && compareAggregate(first, eligible[end]!) === 0) end += 1;
    const slotPercent = PAYOUT_PERCENT.slice(index, Math.min(end, PAYOUT_PERCENT.length)).reduce((sum, value) => sum + value, 0);
    const groupPool = Math.floor(allocation.poolLuna * slotPercent / 100);
    const perWallet = Math.floor(groupPool / (end - index));
    for (let cursor = index; cursor < end; cursor += 1) {
      const candidate = eligible[cursor]!;
      rewards.push({ period, rank: index + 1, walletAddress: candidate.walletAddress, amountLuna: perWallet, qualifyingDays: candidate.days.size, aggregateScore: candidate.aggregateScore });
    }
    index = end;
  }
  const obligationsLuna = rewards.reduce((sum, reward) => sum + reward.amountLuna, 0);
  remainderLuna += allocation.poolLuna - obligationsLuna;
  return { ...allocation, eligibleWallets: eligible.length, rewards, obligationsLuna, remainderLuna };
}

interface Aggregate { walletAddress: string; days: Map<string, RelayRewardRun>; }
interface AggregateResult extends Aggregate { aggregateScore: number; bankedNodes: number; bestChain: number; damageTaken: number; integrityRemaining: number; }

function toAggregateResult(candidate: Aggregate, bestDayCount: number): AggregateResult {
  const best = [...candidate.days.values()].sort(compareRun).slice(0, bestDayCount);
  return { ...candidate, aggregateScore: best.reduce((sum, run) => sum + run.score, 0), bankedNodes: best.reduce((sum, run) => sum + run.bankedNodes, 0), bestChain: Math.max(...best.map((run) => run.bestChain)), damageTaken: best.reduce((sum, run) => sum + run.damageTaken, 0), integrityRemaining: Math.min(...best.map((run) => run.integrityRemaining)) };
}

function compareRun(left: RelayRewardRun, right: RelayRewardRun): number {
  return right.score - left.score || right.bankedNodes - left.bankedNodes || right.bestChain - left.bestChain || left.damageTaken - right.damageTaken || right.integrityRemaining - left.integrityRemaining;
}

function compareAggregate(left: AggregateResult, right: AggregateResult): number {
  return right.aggregateScore - left.aggregateScore || right.bankedNodes - left.bankedNodes || right.bestChain - left.bestChain || left.damageTaken - right.damageTaken || right.integrityRemaining - left.integrityRemaining;
}

function assertLunaAmount(value: number, maximum: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new Error('relay_invalid_luna_amount');
}

function normaliseWallet(address: string): string {
  const value = address.replace(/\s+/g, '').toUpperCase();
  if (value.length === 0 || value.length > 128) throw new Error('relay_invalid_wallet');
  return value;
}

function validateRun(run: RelayRewardRun): void {
  for (const value of [run.score, run.bankedNodes, run.bestChain, run.damageTaken, run.integrityRemaining]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('relay_invalid_reward_run');
  }
  if (!run.missionDate || !run.actorId) throw new Error('relay_invalid_reward_run');
}
