import type { AtlasChainObservation, AtlasChainObserver } from './chain';
import type { AtlasStateStore } from './persistence';
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

interface PersistedAtlasPayouts {
  version: 1;
  payouts: AtlasPayoutRecord[];
}

const PERSISTENCE_KEY = 'atlas-payouts';

export interface AtlasPayoutService {
  create(input: { id: string; period: string; walletAddress: string; amountLuna: number }): Promise<AtlasPayoutRecord>;
  approve(id: string): Promise<AtlasPayoutRecord>;
  recordSubmitted(id: string, transactionHash: string): Promise<AtlasPayoutRecord>;
  reconcile(id: string): Promise<AtlasPayoutRecord>;
  list(): Promise<AtlasPayoutRecord[]>;
}

/**
 * The treasury's payout ledger.
 *
 * `stateStore` is what makes the duplicate-id refusal in `create()` mean
 * anything. Without it the ledger lived in a bare Map, so a restart or a
 * redeploy erased every row including rows already proved `verified`, and each
 * settled reward became payable again out of a real treasury. Persistence is
 * therefore a money-path requirement rather than a convenience, and the
 * service is only safe to wire to a funded treasury with one configured.
 */
export function createAtlasPayoutService(options: { network: AtlasNetwork; treasuryAddress: string; minConfirmations: number; chain: AtlasChainObserver; stateStore?: AtlasStateStore; now?: () => number }): AtlasPayoutService {
  const now = options.now ?? Date.now;
  const payouts = new Map<string, AtlasPayoutRecord>();
  let hydrated = false;
  let operations: Promise<void> = Promise.resolve();

  /**
   * Hydration is latched only after the load resolves.
   *
   * server/atlas/orders.ts paid for the other order once. Setting the flag
   * before awaiting means a single transient read error reports the store
   * hydrated forever; the next accepted write then runs against an empty map
   * and `save()` writes that empty map over the real ledger. The failure is
   * silent and arrives one call late, which on a payout ledger reads as every
   * settled reward being unpaid and payable again.
   */
  async function hydrate(): Promise<void> {
    if (hydrated || !options.stateStore) return;
    const loaded = await options.stateStore.load<PersistedAtlasPayouts | null>(PERSISTENCE_KEY, null);
    if (loaded && loaded.version === 1 && Array.isArray(loaded.payouts)) {
      for (const record of loaded.payouts) if (isPersistedPayout(record)) payouts.set(record.id, structuredClone(record));
    }
    hydrated = true;
  }

  function captureState(): AtlasPayoutRecord[] {
    return [...payouts.values()].map((record) => structuredClone(record));
  }

  function restoreState(records: readonly AtlasPayoutRecord[]): void {
    payouts.clear();
    for (const record of records) payouts.set(record.id, structuredClone(record));
  }

  async function save(): Promise<void> {
    await options.stateStore?.save<PersistedAtlasPayouts>(PERSISTENCE_KEY, { version: 1, payouts: captureState() });
  }

  /**
   * One queue for reads and writes, so a mutation never observes a half
   * hydrated ledger. A failed write rolls the in-memory map back, because
   * leaving memory ahead of disk would let the next successful save persist a
   * change that was refused.
   */
  function serialise<T>(operation: () => Promise<T>, persist: boolean): Promise<T> {
    const result = operations.catch(() => undefined).then(async () => {
      await hydrate();
      const before = persist ? captureState() : null;
      try {
        const value = await operation();
        if (persist) await save();
        return value;
      } catch (error) {
        if (before) restoreState(before);
        throw error;
      }
    });
    operations = result.then(() => undefined, () => undefined);
    return result;
  }

  const read = <T>(operation: () => T): Promise<T> => serialise(async () => operation(), false);
  const update = async (id: string, mutate: (record: AtlasPayoutRecord) => AtlasPayoutRecord): Promise<AtlasPayoutRecord> =>
    serialise(async () => {
      const current = requirePayout(payouts, id);
      const next = mutate(structuredClone(current));
      payouts.set(id, next);
      return next;
    }, true);
  /**
   * Every reconcile outcome lands through this guard instead of being written
   * straight onto the record.
   *
   * The status checks in reconcile() run on a snapshot taken before the chain
   * call, and an RPC round trip is long enough for a second reconcile of the
   * same payout to finish inside it. Without a re-read the slower caller's
   * outcome overwrites the faster one, so a payout another call already proved
   * 'verified' gets pushed back to 'confirming' or 'failed' by a stale
   * observation. The treasury row then reports unpaid for money that moved,
   * which is the direction of this bug that costs something.
   *
   * The re-read has to happen inside update()'s serialised queue, because that
   * is the only place the current status can be trusted. 'verified' is
   * terminal, and a changed hash means this observation describes a different
   * submission than the one being settled.
   */
  const settle = (id: string, observedHash: string, next: (payout: AtlasPayoutRecord) => AtlasPayoutRecord): Promise<AtlasPayoutRecord> =>
    update(id, (payout) => {
      if (payout.status === 'verified' || payout.transactionHash !== observedHash) return payout;
      return next(payout);
    });
  return {
    async create(input) {
      if (!/^[a-z0-9-]{1,80}$/.test(input.id) || !/^[a-z0-9-]{1,80}$/.test(input.period) || !input.walletAddress) throw new Error('Atlas payout identity is invalid.');
      if (!Number.isSafeInteger(input.amountLuna) || input.amountLuna <= 0) throw new Error('Atlas payout amount must be a positive safe integer in Lunas.');
      return serialise(async () => {
        // The refusal below is the guard against paying one reward twice. It
        // only holds because hydrate() has already restored rows written by a
        // previous process.
        if (payouts.has(input.id)) throw new Error('Atlas payout id already exists.');
        const payout: AtlasPayoutRecord = { id: input.id, period: input.period, walletAddress: input.walletAddress, amountLuna: input.amountLuna, network: options.network, treasuryAddress: options.treasuryAddress, transactionHash: null, status: 'draft', refusalReason: null, createdAt: now() };
        payouts.set(input.id, payout);
        return payout;
      }, true);
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
      // Hydrate before reading the status snapshot, or a payout submitted by a
      // previous process reads as missing rather than as reconcilable.
      const current = await read(() => requirePayout(payouts, id));
      if (current.status === 'verified') return structuredClone(current);
      if (!['submitted', 'confirming', 'unknown'].includes(current.status) || !current.transactionHash) throw new Error('Only submitted Atlas payouts can be reconciled.');
      let observation: (AtlasChainObservation & { reorgDetected?: boolean }) | null = null;
      try { observation = await options.chain.observe(current.transactionHash); } catch { return settle(id, current.transactionHash, (payout) => ({ ...payout, status: 'unknown', refusalReason: 'chain_observer_unavailable' })); }
      if (!observation) return settle(id, current.transactionHash, (payout) => ({ ...payout, status: 'confirming', refusalReason: 'transaction_not_in_observer' }));
      if (observation.reorgDetected) return settle(id, current.transactionHash, (payout) => ({ ...payout, status: 'reorg', refusalReason: 'chain_reorg_detected' }));
      const mismatch = observation.network !== options.network || observation.sender !== options.treasuryAddress || observation.recipient !== current.walletAddress || observation.valueLuna !== current.amountLuna || !observation.success || !observation.canonical;
      if (mismatch) return settle(id, current.transactionHash, (payout) => ({ ...payout, status: 'failed', refusalReason: 'chain_evidence_mismatch' }));
      if (!Number.isSafeInteger(observation.confirmations) || observation.confirmations < options.minConfirmations) return settle(id, current.transactionHash, (payout) => ({ ...payout, status: 'confirming', refusalReason: 'minimum_confirmations_not_reached' }));
      return settle(id, current.transactionHash, (payout) => ({ ...payout, status: 'verified', refusalReason: null }));
    },
    async list() { return read(() => [...payouts.values()].map((payout) => structuredClone(payout))); },
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

/**
 * Disk is not a trusted input. A row that fails this check is dropped rather
 * than loaded, because a malformed status or amount reaching the treasury
 * summary is worse than a missing row an operator can re-enter.
 */
function isPersistedPayout(value: unknown): value is AtlasPayoutRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Partial<AtlasPayoutRecord>;
  return typeof record.id === 'string' && /^[a-z0-9-]{1,80}$/.test(record.id)
    && typeof record.period === 'string' && /^[a-z0-9-]{1,80}$/.test(record.period)
    && typeof record.walletAddress === 'string' && record.walletAddress.length > 0 && record.walletAddress.length <= 256
    && typeof record.amountLuna === 'number' && Number.isSafeInteger(record.amountLuna) && record.amountLuna > 0
    && (record.network === 'testalbatross' || record.network === 'mainalbatross')
    && typeof record.treasuryAddress === 'string' && record.treasuryAddress.length <= 256
    && (record.transactionHash === null || (typeof record.transactionHash === 'string' && /^[A-Za-z0-9._:-]{1,256}$/.test(record.transactionHash)))
    && ['draft', 'approved', 'submitted', 'confirming', 'unknown', 'verified', 'failed', 'reorg'].includes(record.status ?? '')
    && (record.refusalReason === null || (typeof record.refusalReason === 'string' && record.refusalReason.length <= 256))
    && typeof record.createdAt === 'number' && Number.isSafeInteger(record.createdAt) && record.createdAt >= 0;
}

function requirePayout(payouts: Map<string, AtlasPayoutRecord>, id: string): AtlasPayoutRecord {
  const payout = payouts.get(id);
  if (!payout) throw new Error('Atlas payout was not found.');
  return payout;
}

function maskAddress(address: string): string { return address.length <= 8 ? '...' : `${address.slice(0, 4)}...${address.slice(-4)}`; }
