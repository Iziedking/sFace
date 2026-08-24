import {
  RELAY_BASE_NODE_SCORE,
  RELAY_CHAIN_BONUS,
  RELAY_COLLISION_COOLDOWN_TICKS,
  RELAY_COURSE_HEIGHT,
  RELAY_COURSE_WIDTH,
  RELAY_FIXED_SCALE,
  RELAY_FORWARD_SPEED_FIXED,
  RELAY_INITIAL_INTEGRITY,
  RELAY_INTEGRITY_BONUS,
  RELAY_MAX_REPAIR_UNITS_PER_ACTOR_DAY,
  RELAY_NODE_CAPACITY,
  RELAY_NO_DAMAGE_BONUS,
  RELAY_POD_HEIGHT,
  RELAY_POD_WIDTH,
  RELAY_REPAIR_SCORE_DIVISOR,
  RELAY_ROUTE_RISK_BONUS,
  RELAY_STEER_SPEED_FIXED,
  RELAY_TICK_RATE,
  RELAY_RUN_TICKS,
} from './constants';
import type { RelayInputSegment, RelayRuleset } from './types';

export const RELAY_RULESET: RelayRuleset = Object.freeze({
  version: 'relay-1',
  tickRate: RELAY_TICK_RATE,
  runTicks: RELAY_RUN_TICKS,
  fixedScale: RELAY_FIXED_SCALE,
  courseWidth: RELAY_COURSE_WIDTH,
  courseHeight: RELAY_COURSE_HEIGHT,
  podWidth: RELAY_POD_WIDTH,
  podHeight: RELAY_POD_HEIGHT,
  forwardSpeedFixed: RELAY_FORWARD_SPEED_FIXED,
  steerSpeedFixed: RELAY_STEER_SPEED_FIXED,
  initialIntegrity: RELAY_INITIAL_INTEGRITY,
  nodeCapacity: RELAY_NODE_CAPACITY,
  collisionCooldownTicks: RELAY_COLLISION_COOLDOWN_TICKS,
  baseNodeScore: RELAY_BASE_NODE_SCORE,
  routeRiskBonus: RELAY_ROUTE_RISK_BONUS,
  chainBonus: RELAY_CHAIN_BONUS,
  integrityBonus: RELAY_INTEGRITY_BONUS,
  noDamageBonus: RELAY_NO_DAMAGE_BONUS,
  repairScoreDivisor: RELAY_REPAIR_SCORE_DIVISOR,
  repairUnitCap: RELAY_MAX_REPAIR_UNITS_PER_ACTOR_DAY,
});

export const RELAY_GOLDEN_FIXTURE = Object.freeze({
  segments: [
    { startTick: 0, tickCount: 10, steerX: 0, flags: 0 },
    { startTick: 10, tickCount: 10, steerX: 127, flags: 0 },
    { startTick: 20, tickCount: 20, steerX: -64, flags: 0 },
    { startTick: 40, tickCount: 10, steerX: 64, flags: 0 },
    { startTick: 50, tickCount: 1_300, steerX: 0, flags: 0 },
  ] satisfies RelayInputSegment[],
  expected: {
    steerTotal: 630,
    horizontalDelta: 2_520,
    scoreInputs: {
      bankedNodes: 3,
      riskBonusCount: 2,
      bestChain: 3,
      integrityRemaining: 3,
      damageTaken: 0,
    },
  },
});

export function scoreGoldenFixture(): { score: number; repairUnits: number } {
  const inputs = RELAY_GOLDEN_FIXTURE.expected.scoreInputs;
  const score =
    inputs.bankedNodes * RELAY_RULESET.baseNodeScore +
    inputs.riskBonusCount * RELAY_RULESET.routeRiskBonus +
    inputs.bestChain * RELAY_RULESET.chainBonus +
    inputs.integrityRemaining * RELAY_RULESET.integrityBonus +
    (inputs.damageTaken === 0 ? RELAY_RULESET.noDamageBonus : 0);
  return {
    score,
    repairUnits: Math.min(RELAY_RULESET.repairUnitCap, Math.floor(score / RELAY_RULESET.repairScoreDivisor)),
  };
}
