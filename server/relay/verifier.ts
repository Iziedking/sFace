import { hashRelayTrace, canonicalRelayTrace } from '../../shared/relay/trace';
import { replayRelayTrace } from '../../shared/relay/replay';
import type { RelayMission } from '../../shared/relay/mission';
import type { RelayResult, RelayRuleset, RelayTrace } from '../../shared/relay/types';

export type RelayVerification =
  | { ok: true; traceHash: string; result: RelayResult }
  | { ok: false; error: 'trace_reused_by_another_actor' | 'duplicate_trace' | 'invalid_trace' };

export class RelayVerifier {
  private readonly owners = new Map<string, string>();

  async verify(input: {
    actorId: string;
    mission: RelayMission;
    trace: RelayTrace;
    ruleset: RelayRuleset;
    claimedResult?: unknown;
    expectedTraceHash?: string;
  }): Promise<RelayVerification> {
    try {
      const canonical = canonicalRelayTrace(input.trace);
      const traceHash = await hashRelayTrace(canonical);
      if (input.expectedTraceHash !== undefined && input.expectedTraceHash !== traceHash) {
        return { ok: false, error: 'invalid_trace' };
      }
      const owner = this.owners.get(traceHash);
      if (owner && owner !== input.actorId) return { ok: false, error: 'trace_reused_by_another_actor' };
      if (owner) return { ok: false, error: 'duplicate_trace' };
      const result = replayRelayTrace(input.mission, canonical, input.ruleset, input.claimedResult);
      this.owners.set(traceHash, input.actorId);
      return { ok: true, traceHash, result };
    } catch {
      return { ok: false, error: 'invalid_trace' };
    }
  }
}
