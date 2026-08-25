import { RELAY_RUN_TICKS, RELAY_STEER_MAX, RELAY_STEER_MIN } from '../../shared/relay/constants';
import { RELAY_RULESET } from '../../shared/relay/ruleset';
import { canonicalRelayTrace, hashRelayTrace } from '../../shared/relay/trace';
import type { RelayInputSegment, RelayResult, RelayTrace } from '../../shared/relay/types';
import { submitPendingRun, type PendingRunStore } from './pending-runs';

export interface RelayTraceMetadata {
  missionDate: string;
  seedCommitment: string;
  ticketId: string;
}

export class RelayTraceRecorder {
  private readonly segments: RelayInputSegment[] = [];
  private tick = 0;

  constructor(private readonly metadata: RelayTraceMetadata) {}

  record(steerX: number, flags = 0): void {
    if (this.tick >= RELAY_RUN_TICKS) throw new Error('Relay trace exceeds the authoritative tick length.');
    if (!Number.isInteger(steerX) || steerX < RELAY_STEER_MIN || steerX > RELAY_STEER_MAX) {
      throw new Error('Relay trace steering value is invalid.');
    }
    if (flags !== 0) throw new Error('Relay trace flags contain reserved bits.');
    const previous = this.segments[this.segments.length - 1];
    if (previous && previous.steerX === steerX && previous.flags === flags) previous.tickCount += 1;
    else this.segments.push({ startTick: this.tick, tickCount: 1, steerX, flags });
    this.tick += 1;
  }

  finish(totalTicks = RELAY_RUN_TICKS): RelayTrace {
    if (totalTicks !== RELAY_RUN_TICKS) throw new Error('Relay trace must use the authoritative tick length.');
    while (this.tick < totalTicks) this.record(0);
    return canonicalRelayTrace({
      version: 1,
      ruleset: RELAY_RULESET.version,
      missionDate: this.metadata.missionDate,
      seedCommitment: this.metadata.seedCommitment,
      ticketId: this.metadata.ticketId,
      segments: this.segments.map((segment) => ({ ...segment })),
    });
  }
}

export async function createRelayRunPayload(input: {
  runId: string;
  actorId: string;
  walletAddress: string;
  network: 'main' | 'test';
  trace: RelayTrace;
  result: RelayResult;
}): Promise<{ runId: string; payload: string; traceHash: string; trace: RelayTrace }> {
  const trace = canonicalRelayTrace(input.trace);
  const traceHash = await hashRelayTrace(trace);
  const payload = JSON.stringify({
    id: input.runId,
    actorId: input.actorId,
    ticketId: trace.ticketId,
    walletAddress: input.walletAddress,
    missionDate: trace.missionDate,
    network: input.network,
    ruleset: trace.ruleset,
    seedCommitment: trace.seedCommitment,
    traceHash,
    trace,
    result: input.result,
  });
  return { runId: input.runId, payload, traceHash, trace };
}

export async function submitCompletedRelayRun<T>(input: {
  store: PendingRunStore;
  runId: string;
  actorId: string;
  walletAddress: string;
  network: 'main' | 'test';
  trace: RelayTrace;
  result: RelayResult;
  createdAt: number;
  query: (runId: string) => Promise<T | null>;
  send: (payload: string) => Promise<T>;
}): Promise<T> {
  const submission = await createRelayRunPayload(input);
  return submitPendingRun({
    store: input.store,
    runId: submission.runId,
    payload: submission.payload,
    createdAt: input.createdAt,
    query: input.query,
    send: input.send,
  });
}
