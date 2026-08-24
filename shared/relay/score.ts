import { assertRelayResult, type RelayResult, type RelayRuleset } from './types';
import { RELAY_MAX_REPAIR_UNITS_PER_ACTOR_DAY } from './constants';
import type { RelayState } from './state';

export function deriveRelayResult(state: RelayState, ruleset: RelayRuleset): RelayResult {
  const score =
    state.bankedNodes * ruleset.baseNodeScore +
    state.riskBonusCount * ruleset.routeRiskBonus +
    state.bestChain * ruleset.chainBonus +
    state.pod.integrity * ruleset.integrityBonus +
    (state.damageTaken === 0 ? ruleset.noDamageBonus : 0);
  if (!Number.isSafeInteger(score) || score < 0) throw new Error('Relay score exceeded safe integer limits.');
  const repairUnits = Math.min(
    RELAY_MAX_REPAIR_UNITS_PER_ACTOR_DAY,
    Math.floor(score / ruleset.repairScoreDivisor),
  );
  const result: RelayResult = {
    score,
    bankedNodes: state.bankedNodes,
    damageTaken: state.damageTaken,
    bestChain: state.bestChain,
    integrityRemaining: state.pod.integrity,
    completedTicks: state.completedTicks,
    repairUnits,
  };
  assertRelayResult(result);
  return result;
}
