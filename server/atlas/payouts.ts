import type { AtlasChainObservation, AtlasChainReader } from './chain';
import type { AtlasNetwork } from '../../shared/atlas/types';

export type AtlasPayoutStatus = 'draft' | 'approved' | 'submitted' | 'confirming' | 'unknown' | 'verified' | 'failed' | 'reorg';

export interface AtlasPayoutRecord {
  id: string;
  period: string;
  walletAddress: string;
  amountLuna: number;
  network: AtlasNetwork;
  treasuryAddress: string;
  transactionHash: string | null;
  status: AtlasPayoutStatus;
  refusalReason: string | null;
  createdAt: number;
}

export interface AtlasPayoutService {
  create(input: { id: string; period: string; walletAddress: string; amountLuna: number }): Promise<AtlasPayoutRecord>;
  approve(id: string): Promise<AtlasPayoutRecord>;
  recordSubmitted(id: string, transactionHash: string): Promise<AtlasPayoutRecord>;
  reconcile(id: string): Promise<AtlasPayoutRecord>;
  list(): Promise<AtlasPayoutRecord[]>;
}

export function createAtlasPayoutService(options: { network: AtlasNetwork; treasuryAddress: string; minConfirmations: number; chain: AtlasChainReader; now?: () => number }): AtlasPayoutService {
  const now = options.now ?? Date.now;
  const payouts = new Map<string, AtlasPayoutRecord>();
  let operations: Promise<void> = Promise.resolve();
  const serialise = (operation: () => Promise<void>): Promise<void> => { operations = operations.catch(() => undefined).then(operation); return operations; };
  const update = async (id: string, mutate: (record: AtlasPayoutRecord) => AtlasPayoutRecord): Promise<AtlasPayoutRecord> => {
    let result: AtlasPayoutRecord | null = null;
    await serialise(async () => { const current = requirePayout(payouts, id); const next = mutate(structuredClone(current)); payouts.set(id, next); result = next; });
    return result ?? (() => { throw new Error('Atlas payout update was not produced.'); })();
  };
  return {
    async create(input) {
      if (!/^[a-z0-9-]{1,80}$/.test(input.id) || !/^[a-z0-9-]{1,80}$/.test(input.period) || !input.walletAddress) throw new Error('Atlas payout identity is invalid.');
      if (!Number.isSafeInteger(input.amountLuna) || input.amountLuna <= 0) throw new Error('Atlas payout amount must be a positive safe integer in Lunas.');
      let result: AtlasPayoutRecord | null = null;
      await serialise(async () => {
        if (payouts.has(input.id)) throw new Error('Atlas payout id already exists.');
        const payout: AtlasPayoutRecord = { id: input.id, period: input.period, walletAddress: input.walletAddress, amountLuna: input.amountLuna, network: options.network, treasuryAddress: options.treasuryAddress, transactionHash: null, status: 'draft', refusalReason: null, createdAt: now() };
        payouts.set(input.id, payout);
        result = payout;
      });
      return result!;
    },
    approve(id) { return update(id, (payout) => { if (payout.status !== 'draft') throw new Error('Only draft Atlas payouts can be approved.'); return { ...payout, status: 'approved', refusalReason: null }; }); },
    recordSubmitted(id, transactionHash) {
      if (!/^[A-Za-z0-9._:-]{1,256}$/.test(transactionHash)) return Promise.reject(new Error('Atlas payout transaction hash is invalid.'));
      return update(id, (payout) => {
        if (payout.status !== 'approved') throw new Error('Only approved Atlas payouts can be submitted.');
        for (const candidate of payouts.values()) if (candidate.id !== id && candidate.transactionHash === transactionHash) throw new Error('Atlas payout transaction hash is duplicate.');
        return { ...payout, status: 'submitted', transactionHash, refusalReason: null };
      });
    },
    async reconcile(id) {
      const current = requirePayout(payouts, id);
      if (current.status === 'verified') return structuredClone(current);
      if (!['submitted', 'confirming', 'unknown'].includes(current.status) || !current.transactionHash) throw new Error('Only submitted Atlas payouts can be reconciled.');
      let observation: (AtlasChainObservation & { reorgDetected?: boolean }) | null = null;
      try { observation = await options.chain.observe(current.transactionHash); } catch { return update(id, (payout) => ({ ...payout, status: 'unknown', refusalReason: 'chain_observer_unavailable' })); }
      if (!observation) return update(id, (payout) => ({ ...payout, status: 'confirming', refusalReason: 'transaction_not_in_observer' }));
      if (observation.reorgDetected) return update(id, (payout) => ({ ...payout, status: 'reorg', refusalReason: 'chain_reorg_detected' }));
      const mismatch = observation.network !== options.network || observation.sender !== options.treasuryAddress || observation.recipient !== current.walletAddress || observation.valueLuna !== current.amountLuna || !observation.success || !observation.canonical;
      if (mismatch) return update(id, (payout) => ({ ...payout, status: 'failed', refusalReason: 'chain_evidence_mismatch' }));
      if (!Number.isSafeInteger(observation.confirmations) || observation.confirmations < options.minConfirmations) return update(id, (payout) => ({ ...payout, status: 'confirming', refusalReason: 'minimum_confirmations_not_reached' }));
      return update(id, (payout) => ({ ...payout, status: 'verified', refusalReason: null }));
    },
    async list() { return [...payouts.values()].map((payout) => structuredClone(payout)); },
  };
}

export function atlasPayoutSummary(records: readonly AtlasPayoutRecord[], input: { allocationLuna: number; rolloverLuna: number; obligationsLuna: number }): {
  allocationLuna: number;
  rolloverLuna: number;
  obligationsLuna: number;
  verifiedPayoutsLuna: number;
  paidLuna: number;
  unawardedLuna: number;
  payouts: Array<{ id: string; period: string; amountLuna: number; status: AtlasPayoutStatus; walletAddress: string }>;
} {
  const verifiedPayoutsLuna = records.filter((record) => record.status === 'verified').reduce((total, record) => total + record.amountLuna, 0);
  return {
    allocationLuna: input.allocationLuna, rolloverLuna: input.rolloverLuna, obligationsLuna: input.obligationsLuna, verifiedPayoutsLuna, paidLuna: verifiedPayoutsLuna,
    unawardedLuna: Math.max(0, input.allocationLuna - input.rolloverLuna - input.obligationsLuna),
    payouts: records.map((record) => ({ id: record.id, period: record.period, amountLuna: record.amountLuna, status: record.status, walletAddress: maskAddress(record.walletAddress) })),
  };
}

function requirePayout(payouts: Map<string, AtlasPayoutRecord>, id: string): AtlasPayoutRecord {
  const payout = payouts.get(id);
  if (!payout) throw new Error('Atlas payout was not found.');
  return payout;
}

function maskAddress(address: string): string { return address.length <= 8 ? '...' : `${address.slice(0, 4)}...${address.slice(-4)}`; }
