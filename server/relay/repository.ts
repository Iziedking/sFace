import { assertRelayResult, type RelayRunRecord } from '../../shared/relay/types';
import type { RelayPayoutRecord, RelaySnapshot, RelayStore } from './store';
import { hashRelayTraceBytes, type RelayTraceStore } from './traces';

export type { RelayPayoutRecord } from './store';

export type RelayRepositoryErrorCode =
  | 'relay_duplicate_run'
  | 'relay_ticket_used'
  | 'relay_trace_reused'
  | 'relay_daily_best_exists'
  | 'relay_trace_hash_mismatch'
  | 'relay_reward_duplicate'
  | 'relay_transaction_duplicate';

export class RelayRepositoryError extends Error {
  readonly code: RelayRepositoryErrorCode;

  constructor(code: RelayRepositoryErrorCode, message: string) {
    super(message);
    this.name = 'RelayRepositoryError';
    this.code = code;
  }
}

export interface RelayRepository {
  acceptRun(run: RelayRunRecord, traceBytes: Uint8Array): Promise<RelayRunRecord>;
  getRun(runId: string): Promise<RelayRunRecord | null>;
  recordPayout(payout: RelayPayoutRecord): Promise<RelayPayoutRecord>;
}

export function createRelayRepository(options: { store: RelayStore; traces: RelayTraceStore }): RelayRepository {
  let snapshot: RelaySnapshot | null = null;
  let operations: Promise<void> = Promise.resolve();

  const serialise = (operation: () => Promise<void>): Promise<void> => {
    operations = operations.catch(() => undefined).then(operation);
    return operations;
  };

  const ensureSnapshot = async (): Promise<RelaySnapshot> => {
    if (!snapshot) snapshot = await options.store.load();
    return snapshot;
  };

  return {
    async acceptRun(run, traceBytes) {
      let accepted = false;
      await serialise(async () => {
        const current = await ensureSnapshot();
        if (current.verifiedRuns[run.id]) throw new RelayRepositoryError('relay_duplicate_run', 'Run id has already been accepted.');
        const ticket = current.tickets[run.ticketId];
        if (ticket?.usedByRunId && ticket.usedByRunId !== run.id) throw new RelayRepositoryError('relay_ticket_used', 'Ticket has already been consumed.');
        if (ticket && ticket.actorId !== run.actorId) throw new RelayRepositoryError('relay_ticket_used', 'Ticket belongs to another actor.');
        const existingTrace = Object.values(current.verifiedRuns).find((candidate) => candidate.traceHash === run.traceHash);
        if (existingTrace) throw new RelayRepositoryError('relay_trace_reused', 'Trace hash has already been accepted.');
        assertRelayResult(run.result);
        if (await hashRelayTraceBytes(traceBytes) !== run.traceHash) throw new RelayRepositoryError('relay_trace_hash_mismatch', 'Trace content does not match the submitted hash.');

        const bestKey = `${run.actorId}:${run.missionDate}`;
        const existingBestId = current.dailyBests[bestKey];
        if (existingBestId) {
          const existingBest = current.verifiedRuns[existingBestId];
          if (existingBest && existingBest.result.score >= run.result.score) throw new RelayRepositoryError('relay_daily_best_exists', 'A higher or equal daily best already exists.');
        }

        await options.traces.save(run.traceHash, traceBytes);
        const next = cloneSnapshot(current);
        next.verifiedRuns[run.id] = run;
        next.tickets[run.ticketId] = { id: run.ticketId, actorId: run.actorId, missionDate: run.missionDate, usedByRunId: run.id };
        next.dailyBests[bestKey] = run.id;
        await options.store.commit('run.accepted', next);
        snapshot = next;
        accepted = true;
      });
      if (!accepted) throw new Error('Relay run was not accepted.');
      return run;
    },
    async getRun(runId) {
      await operations.catch(() => undefined);
      const current = await ensureSnapshot();
      const run = current.verifiedRuns[runId];
      return run ? structuredClone(run) : null;
    },
    async recordPayout(payout) {
      let recorded = false;
      await serialise(async () => {
        const current = await ensureSnapshot();
        const duplicateReward = Object.values(current.payouts).some((candidate) => candidate.period === payout.period && candidate.walletAddress === payout.walletAddress);
        if (duplicateReward) throw new RelayRepositoryError('relay_reward_duplicate', 'A reward already exists for this period and wallet.');
        if (payout.transactionHash && Object.values(current.payouts).some((candidate) => candidate.transactionHash === payout.transactionHash)) {
          throw new RelayRepositoryError('relay_transaction_duplicate', 'Transaction hash has already been recorded.');
        }
        const next = cloneSnapshot(current);
        next.payouts[payout.id] = payout;
        await options.store.commit('payout.recorded', next);
        snapshot = next;
        recorded = true;
      });
      if (!recorded) throw new Error('Relay payout was not recorded.');
      return payout;
    },
  };
}

function cloneSnapshot(snapshot: RelaySnapshot): RelaySnapshot {
  return structuredClone(snapshot);
}
