import { createRelayState } from './state';
import { deriveRelayResult } from './score';
import { stepRelay } from './step';
import { canonicalRelayTrace } from './trace';
import { assertRelayResult, assertRelayTrace, type RelayResult, type RelayRuleset, type RelayTrace } from './types';
import type { RelayMission } from './mission';

type ReplayMission = RelayMission & { missionDate?: string; seedCommitment?: string };

export function replayRelayTrace(
  mission: ReplayMission,
  trace: RelayTrace,
  ruleset: RelayRuleset,
  claimedResult?: unknown,
): RelayResult {
  assertRelayTrace(trace);
  if (mission.ruleset !== ruleset.version || trace.ruleset !== ruleset.version) throw new Error('Replay ruleset mismatch.');
  if (mission.missionDate !== undefined && trace.missionDate !== mission.missionDate) throw new Error('Replay mission date mismatch.');
  if (mission.seedCommitment !== undefined && trace.seedCommitment !== mission.seedCommitment) throw new Error('Replay seed commitment mismatch.');
  if (mission.seedHex.length !== 64) throw new Error('Replay mission seed is invalid.');

  const state = createRelayState(mission);
  for (const segment of canonicalRelayTrace(trace).segments) {
    for (let tick = 0; tick < segment.tickCount; tick += 1) {
      stepRelay(state, { steerX: segment.steerX, flags: segment.flags }, ruleset);
    }
  }
  const result = deriveRelayResult(state, ruleset);
  if (claimedResult !== undefined) {
    assertRelayResult(claimedResult);
    if (JSON.stringify(claimedResult) !== JSON.stringify(result)) throw new Error('Client summary differs from authoritative replay.');
  }
  return result;
}
