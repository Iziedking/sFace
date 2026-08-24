import {
  RELAY_COURSE_HEIGHT,
  RELAY_COURSE_WIDTH,
  RELAY_PICKUP_RADIUS,
  RELAY_STEER_MAX,
  RELAY_STEER_MIN,
} from './constants';
import type { RelayRuleset } from './types';
import type { RelayState } from './state';

export interface RelayTickInput {
  steerX: number;
  flags: number;
}

function distanceSquared(leftX: number, leftY: number, rightX: number, rightY: number): number {
  const x = leftX - rightX;
  const y = leftY - rightY;
  return x * x + y * y;
}

function clampSteer(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(RELAY_STEER_MIN, Math.min(RELAY_STEER_MAX, Math.trunc(value)));
}

function resolveCollision(state: RelayState, ruleset: RelayRuleset): void {
  if (state.pod.collisionCooldown > 0) {
    state.pod.collisionCooldown -= 1;
    return;
  }
  const podRadius = Math.max(ruleset.podWidth, ruleset.podHeight) / 2;
  const hazard = state.hazards.find((item) =>
    distanceSquared(state.pod.x, state.pod.y, item.x, item.y) <= (podRadius + item.radius) ** 2,
  );
  if (!hazard) return;
  state.pod.integrity = Math.max(0, state.pod.integrity - 1);
  state.damageTaken += 1;
  state.pod.collisionCooldown = ruleset.collisionCooldownTicks;
  if (state.carrying > 0) {
    for (let index = state.nodes.length - 1; index >= 0; index -= 1) {
      const carried = state.nodes[index];
      if (carried?.status !== 'carried') continue;
      carried.status = 'dropped';
      state.carrying -= 1;
      state.carryingRisk -= carried.risk;
      state.droppedNodes += 1;
      break;
    }
  }
}

function pickUpNodes(state: RelayState, ruleset: RelayRuleset): void {
  for (const node of state.nodes) {
    if (state.carrying >= ruleset.nodeCapacity) return;
    if (node.status !== 'available') continue;
    if (distanceSquared(state.pod.x, state.pod.y, node.x, node.y) > RELAY_PICKUP_RADIUS ** 2) continue;
    node.status = 'carried';
    state.carrying += 1;
    state.carryingRisk += node.risk;
  }
}

function bankAtRelayGate(state: RelayState): void {
  const gate = state.gates.find((item) => distanceSquared(state.pod.x, state.pod.y, item.x, item.y) <= RELAY_PICKUP_RADIUS ** 2);
  if (!gate || state.carrying === 0) return;
  const banked = state.carrying;
  for (const node of state.nodes) {
    if (node.status === 'carried') node.status = 'banked';
  }
  state.bankedNodes += banked;
  state.currentChain = banked;
  state.bestChain = Math.max(state.bestChain, banked);
  state.riskBonusCount += state.carryingRisk;
  state.carrying = 0;
  state.carryingRisk = 0;
}

export function stepRelay(state: RelayState, input: RelayTickInput, ruleset: RelayRuleset): void {
  if (state.phase === 'finished') return;
  if (input.flags !== 0) throw new Error('Relay tick flags contain reserved bits.');
  const steerX = clampSteer(input.steerX);
  const halfPod = ruleset.podWidth / 2;
  state.pod.x = Math.max(
    halfPod,
    Math.min(RELAY_COURSE_WIDTH - halfPod, state.pod.x + steerX * ruleset.steerSpeedFixed),
  );
  state.pod.y = Math.min(RELAY_COURSE_HEIGHT, state.pod.y + ruleset.forwardSpeedFixed);
  resolveCollision(state, ruleset);
  pickUpNodes(state, ruleset);
  bankAtRelayGate(state);
  state.completedTicks += 1;
  if (state.pod.integrity <= 0 || state.completedTicks >= ruleset.runTicks) state.phase = 'finished';
}
