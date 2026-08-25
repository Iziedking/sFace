import type { RelayChainObservation, RelayChainReader } from './chain';
import type { RelayPayoutRecord, RelaySnapshot, RelayStore } from './store';

export type RelayPayoutStatus = 'draft' | 'approved' | 'submitted' | 'confirming' | 'unknown' | 'verified' | 'failed';

export class RelayPayoutError extends Error {
  readonly code: 'relay_payout_invalid_amount' | 'relay_payout_not_found' | 'relay_payout_invalid_transition' | 'relay_transaction_duplicate';
  constructor(code: RelayPayoutError['code'], message: string) { super(message); this.name = 'RelayPayoutError'; this.code = code; }
}

export interface RelayPayoutService {
  create(input: { id: string; period: string; walletAddress: string; amountLuna: number }): Promise<RelayPayoutRecord>;
  approve(id: string): Promise<RelayPayoutRecord>;
  recordSubmitted(id: string, transactionHash: string): Promise<RelayPayoutRecord>;
  reconcile(id: string): Promise<RelayPayoutRecord>;
}

export function createRelayPayoutService(options: { store: RelayStore; chain: RelayChainReader; treasuryAddress: string; minConfirmations: number; network: 'main' | 'test' }): RelayPayoutService {
  let snapshot: RelaySnapshot | null = null;
  let operations: Promise<void> = Promise.resolve();
  const ensure = async (): Promise<RelaySnapshot> => { if (!snapshot) snapshot = await options.store.load(); return snapshot; };
  const serialise = (operation: () => Promise<void>): Promise<void> => { operations = operations.catch(() => undefined).then(operation); return operations; };
  const persist = async (kind: string, next: RelaySnapshot): Promise<void> => { await options.store.commit(kind, next); snapshot = next; };
  const get = async (id: string): Promise<RelayPayoutRecord> => { const current = await ensure(); const payout = current.payouts[id]; if (!payout) throw new RelayPayoutError('relay_payout_not_found', 'Payout was not found.'); return structuredClone(payout); };
  const update = async (kind: string, id: string, mutate: (payout: RelayPayoutRecord) => RelayPayoutRecord): Promise<RelayPayoutRecord> => {
    let result: RelayPayoutRecord | null = null;
    await serialise(async () => { const current = await ensure(); const payout = current.payouts[id]; if (!payout) throw new RelayPayoutError('relay_payout_not_found', 'Payout was not found.'); const next = structuredClone(current); const updated = mutate(structuredClone(payout)); next.payouts[id] = updated; await persist(kind, next); result = updated; });
    return result ?? (() => { throw new Error('Payout update was not produced.'); })();
  };
  return {
    async create(input) {
      if (!Number.isSafeInteger(input.amountLuna) || input.amountLuna <= 0) throw new RelayPayoutError('relay_payout_invalid_amount', 'Payout amount must be a positive safe integer in Lunas.');
      let result: RelayPayoutRecord | null = null;
      await serialise(async () => { const current = await ensure(); if (current.payouts[input.id]) throw new RelayPayoutError('relay_payout_invalid_transition', 'Payout id already exists.'); const next = structuredClone(current); const payout: RelayPayoutRecord = { id: input.id, period: input.period, walletAddress: input.walletAddress, amountLuna: input.amountLuna, transactionHash: null, status: 'draft', refusalReason: null, network: options.network, treasuryAddress: options.treasuryAddress, createdAt: Date.now() }; next.payouts[input.id] = payout; await persist('payout.draft', next); result = payout; });
      return result!;
    },
    approve(id) { return update('payout.approved', id, (payout) => { if (payout.status !== 'draft') throw new RelayPayoutError('relay_payout_invalid_transition', 'Only draft payouts can be approved.'); return { ...payout, status: 'approved', refusalReason: null }; }); },
    recordSubmitted(id, transactionHash) {
      if (!/^[A-Za-z0-9._:-]{1,256}$/.test(transactionHash)) return Promise.reject(new RelayPayoutError('relay_payout_invalid_transition', 'Transaction hash is invalid.'));
      return update('payout.submitted', id, (payout) => {
        if (payout.status !== 'approved') throw new RelayPayoutError('relay_payout_invalid_transition', 'Only approved payouts can be submitted.');
        const current = snapshot;
        if (current && Object.values(current.payouts).some((candidate) => candidate.id !== id && candidate.transactionHash === transactionHash)) throw new RelayPayoutError('relay_transaction_duplicate', 'Transaction hash already belongs to another payout.');
        return { ...payout, status: 'submitted', transactionHash, refusalReason: null };
      });
    },
    async reconcile(id) {
      const payout = await get(id);
      if (payout.status !== 'submitted' && payout.status !== 'confirming' && payout.status !== 'unknown') throw new RelayPayoutError('relay_payout_invalid_transition', 'Only submitted payouts can be reconciled.');
      let observation: RelayChainObservation | null = null;
      try { observation = payout.transactionHash ? await options.chain.observe(payout.transactionHash) : null; } catch { return update('payout.unknown', id, (current) => ({ ...current, status: 'unknown', refusalReason: 'chain_observer_unavailable' })); }
      if (!observation) return update('payout.confirming', id, (current) => ({ ...current, status: 'confirming', refusalReason: 'transaction_not_in_observer' }));
      const mismatch = observation.network !== options.network || observation.sender !== options.treasuryAddress || observation.recipient !== payout.walletAddress || observation.valueLuna !== payout.amountLuna || !observation.success || !observation.canonical;
      if (mismatch) return update('payout.failed', id, (current) => ({ ...current, status: 'failed', refusalReason: 'chain_evidence_mismatch' }));
      if (observation.confirmations < options.minConfirmations) return update('payout.confirming', id, (current) => ({ ...current, status: 'confirming', refusalReason: 'minimum_confirmations_not_reached' }));
      return update('payout.verified', id, (current) => ({ ...current, status: 'verified', refusalReason: null }));
    },
  };
}

export function createRelayChainStub(input: Omit<RelayChainObservation, 'hash' | 'blockHeight'> & { hash?: string; blockHeight?: number | null }): RelayChainReader {
  return { async observe() { return { hash: input.hash ?? 'hash-1', blockHeight: input.blockHeight ?? 1, network: input.network, confirmations: input.confirmations, sender: input.sender, recipient: input.recipient, valueLuna: input.valueLuna, success: input.success, canonical: input.canonical }; } };
}
