import { ATLAS_DAILY_CHALLENGES, type AtlasDailyChallenge } from '../../shared/atlas/daily';

export type DailySubmitReason = 'identity_required' | 'unknown_challenge' | 'wrong_answer' | 'assistance_used' | 'replay_incomplete' | 'payment_mismatch' | 'payment_unverified' | 'consensus_stale' | 'validator_concentration';

export interface DailySubmitInput {
  actorId?: string;
  walletAddress?: string;
  deviceIdentifier?: string;
  challengeId: string;
  answer: string;
  replayComplete: boolean;
  assistance: 'none' | 'free-hint' | 'purchased-hint' | 'answer-reveal' | 'debug';
  payment?: { txHash?: string; network?: string; recipient?: string; valueLuna?: number; canonical?: boolean; success?: boolean; confirmations?: number };
  consensus?: { established: boolean; observedAt: number };
  validatorDistribution?: { distinctValidators: number; totalValidators: number };
  recovery?: 'wallet-cancelled' | 'offline' | 'retryable-rpc';
}

export interface DailySubmitResult { accepted: boolean; eligible: boolean; duplicate?: boolean; retryable?: boolean; reason?: DailySubmitReason; date: string; }
export interface DailyObligation { status: 'pending-close' | 'not-eligible'; amountLuna: number | null; }

export interface AtlasDailyService {
  submit(input: DailySubmitInput): Promise<DailySubmitResult>;
  estimateShare(eligibleCount: number): number | null;
  pendingObligation(input: { actorId: string; walletAddress: string; challengeId: string }): Promise<DailyObligation>;
}

export function createAtlasDailyService(options: { date: () => string; now?: () => number } ): AtlasDailyService {
  const now = options.now ?? Date.now;
  const accepted = new Set<string>();
  return {
    async submit(input) {
      const date = options.date();
      if (!input.actorId || !input.walletAddress) return rejected(date, 'identity_required');
      const challenge = ATLAS_DAILY_CHALLENGES.find((item) => item.id === input.challengeId);
      if (!challenge) return rejected(date, 'unknown_challenge');
      if (input.answer !== challenge.answer) return rejected(date, 'wrong_answer');
      if (input.assistance !== 'none') return rejected(date, 'assistance_used');
      if (!input.replayComplete) return { ...rejected(date, 'replay_incomplete'), retryable: true };
      const guardResult = validateGuard(challenge, input, now());
      if (guardResult) return rejected(date, guardResult);
      const key = `${date}:${input.actorId}:${input.walletAddress}:${input.challengeId}`;
      if (accepted.has(key)) return { accepted: true, eligible: true, duplicate: true, date };
      accepted.add(key);
      return { accepted: true, eligible: true, date };
    },
    estimateShare(eligibleCount) {
      if (!Number.isSafeInteger(eligibleCount) || eligibleCount <= 0) return null;
      return Math.floor(80_000_000 / eligibleCount);
    },
    async pendingObligation(input) {
      const key = `${options.date()}:${input.actorId}:${input.walletAddress}:${input.challengeId}`;
      return accepted.has(key) ? { status: 'pending-close', amountLuna: null } : { status: 'not-eligible', amountLuna: null };
    },
  };
}

function validateGuard(challenge: AtlasDailyChallenge, input: DailySubmitInput, now: number): DailySubmitReason | null {
  if (challenge.guard === 'payment') {
    const payment = input.payment;
    if (payment?.txHash && (!payment.network || !payment.recipient || payment.valueLuna === undefined || payment.canonical === undefined || payment.success === undefined || payment.confirmations === undefined)) return 'payment_unverified';
    if (!payment || !payment.network || !payment.recipient || payment.valueLuna === undefined || payment.network !== 'testalbatross' || payment.recipient !== 'NQATLASLANTERNSHOP' || payment.valueLuna !== 100_000) return 'payment_mismatch';
    if (!payment.canonical || !payment.success || payment.confirmations === undefined || !Number.isSafeInteger(payment.confirmations) || payment.confirmations < 3) return 'payment_unverified';
  }
  if (challenge.guard === 'consensus') {
    if (!input.consensus || !input.consensus.established || !Number.isSafeInteger(input.consensus.observedAt) || now - input.consensus.observedAt > 5 * 60 * 1_000) return 'consensus_stale';
  }
  if (challenge.guard === 'validator-distribution') {
    if (!input.validatorDistribution || input.validatorDistribution.distinctValidators < 3 || input.validatorDistribution.totalValidators < input.validatorDistribution.distinctValidators) return 'validator_concentration';
  }
  return null;
}

function rejected(date: string, reason: DailySubmitReason): DailySubmitResult { return { accepted: false, eligible: false, reason, date }; }
