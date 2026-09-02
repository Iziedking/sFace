import type { AtlasDailyPoolClose, AtlasRewardPeriod, AtlasTrackRewardAllocation } from '../../shared/atlas/rewards';
import type { AtlasAssistance, AtlasRole } from '../../shared/atlas/types';

export type AtlasRewardLedgerEntry = AtlasDailyCloseEntry | AtlasTrackAllocationEntry;

export interface AtlasDailyCloseEntry {
  kind: 'daily-close';
  date: string;
  poolLuna: number;
  eligibleCount: number;
  awardedLuna: number;
  dustLuna: number;
  status: 'pending-close';
}

export interface AtlasTrackAllocationEntry {
  kind: 'track-allocation';
  period: AtlasRewardPeriod;
  role: AtlasTrackRewardAllocation['role'];
  poolLuna: number;
  obligationsLuna: number;
  remainderLuna: number;
  status: 'pending-close';
}

export interface AtlasRewardLedgerSummary {
  dailyObligationsLuna: number;
  rolloverToFinaleLuna: number;
  weeklyObligationsLuna: number;
  finaleObligationsLuna: number;
  paidLuna: 0;
}

export interface AtlasRewardLedger {
  appendDailyClose(date: string, close: AtlasDailyPoolClose): AtlasDailyCloseEntry;
  appendTrackAllocation(allocation: AtlasTrackRewardAllocation): AtlasTrackAllocationEntry;
  entries(): AtlasRewardLedgerEntry[];
  summary(): AtlasRewardLedgerSummary;
}

export interface AtlasCompetitionSummary {
  role: AtlasRole;
  bestVerifiedScore: number | null;
  eligibility: 'eligible' | 'assisted' | 'not-verified';
  dailyObligation: {
    status: 'estimating' | 'pending' | 'verified-paid' | 'unawarded';
    amountLuna: number | null;
  };
}

export function createAtlasCompetitionSummary(input: {
  role: AtlasRole;
  bestVerifiedScore: number | null;
  assistance: AtlasAssistance;
  daily: { accepted: boolean; closed: boolean; amountLuna: number | null; payoutVerified: boolean };
}): AtlasCompetitionSummary {
  if (input.bestVerifiedScore !== null && (!Number.isSafeInteger(input.bestVerifiedScore) || input.bestVerifiedScore < 0)) throw new Error('Competition score is malformed.');
  if (input.daily.amountLuna !== null && (!Number.isSafeInteger(input.daily.amountLuna) || input.daily.amountLuna < 0)) throw new Error('Competition obligation is malformed.');
  const eligibility = input.assistance === 'none' && input.bestVerifiedScore !== null ? 'eligible' : input.assistance === 'none' ? 'not-verified' : 'assisted';
  const status = !input.daily.closed ? 'estimating' : !input.daily.accepted ? 'unawarded' : input.daily.payoutVerified ? 'verified-paid' : 'pending';
  return { role: input.role, bestVerifiedScore: input.bestVerifiedScore, eligibility, dailyObligation: { status, amountLuna: input.daily.amountLuna } };
}

export function createAtlasRewardLedger(): AtlasRewardLedger {
  const entries: AtlasRewardLedgerEntry[] = [];
  return {
    appendDailyClose(date, close) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Daily reward close date is malformed.');
      if (entries.some((entry) => entry.kind === 'daily-close' && entry.date === date)) throw new Error(`Daily reward close already exists: ${date}`);
      assertNonNegativeSafeIntegers([close.poolLuna, close.eligibleCount, close.awardedLuna, close.dustLuna]);
      if (close.awardedLuna + close.dustLuna !== close.poolLuna) throw new Error('Daily reward close does not conserve its pool.');
      const entry: AtlasDailyCloseEntry = {
        kind: 'daily-close',
        date,
        poolLuna: close.poolLuna,
        eligibleCount: close.eligibleCount,
        awardedLuna: close.awardedLuna,
        dustLuna: close.dustLuna,
        status: 'pending-close',
      };
      entries.push(entry);
      return { ...entry };
    },
    appendTrackAllocation(allocation) {
      if (entries.some((entry) => entry.kind === 'track-allocation' && entry.period === allocation.period && entry.role === allocation.role)) {
        throw new Error(`Track reward allocation already exists: ${allocation.period}/${allocation.role}`);
      }
      assertNonNegativeSafeIntegers([allocation.poolLuna, allocation.obligationsLuna, allocation.remainderLuna]);
      if (allocation.obligationsLuna + allocation.remainderLuna !== allocation.poolLuna) throw new Error('Track reward allocation does not conserve its pool.');
      const entry: AtlasTrackAllocationEntry = {
        kind: 'track-allocation',
        period: allocation.period,
        role: allocation.role,
        poolLuna: allocation.poolLuna,
        obligationsLuna: allocation.obligationsLuna,
        remainderLuna: allocation.remainderLuna,
        status: 'pending-close',
      };
      entries.push(entry);
      return { ...entry };
    },
    entries() {
      return entries.map((entry) => ({ ...entry }));
    },
    summary() {
      return entries.reduce<AtlasRewardLedgerSummary>((summary, entry) => {
        if (entry.kind === 'daily-close') {
          summary.dailyObligationsLuna += entry.awardedLuna;
          summary.rolloverToFinaleLuna += entry.dustLuna;
        } else if (entry.period === 'finale') {
          summary.finaleObligationsLuna += entry.obligationsLuna;
        } else {
          summary.weeklyObligationsLuna += entry.obligationsLuna;
          summary.rolloverToFinaleLuna += entry.remainderLuna;
        }
        return summary;
      }, { dailyObligationsLuna: 0, rolloverToFinaleLuna: 0, weeklyObligationsLuna: 0, finaleObligationsLuna: 0, paidLuna: 0 });
    },
  };
}

function assertNonNegativeSafeIntegers(values: number[]): void {
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) throw new Error('Reward ledger values must be non-negative safe integers.');
}
