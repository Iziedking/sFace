import { describe, expect, it } from 'vitest';

import { RELAY_COURSE_WIDTH, RELAY_RUN_TICKS } from '../shared/relay/constants';
import { createRelayState, type RelayMissionForState } from '../shared/relay/state';
import { stepRelay, type RelayTickInput } from '../shared/relay/step';
import { RELAY_RULESET } from '../shared/relay/ruleset';

const center = Math.floor(RELAY_COURSE_WIDTH / 2);

function mission(overrides: Partial<RelayMissionForState> = {}): RelayMissionForState {
  return {
    seedHex: '01'.repeat(32),
    ruleset: 'relay-1',
    nodes: [],
    gates: [],
    hazards: [],
    sections: [],
    ...overrides,
  };
}

function input(steerX = 0): RelayTickInput {
  return { steerX, flags: 0 };
}

describe('Relay authoritative simulation', () => {
  it('clamps steering and advances automatically', () => {
    const state = createRelayState(mission());
    const before = state.pod.x;
    stepRelay(state, input(127), RELAY_RULESET);
    expect(state.pod.x).toBe(before + 127 * RELAY_RULESET.steerSpeedFixed);
    expect(state.pod.y).toBe(RELAY_RULESET.forwardSpeedFixed);
    stepRelay(state, input(999), RELAY_RULESET);
    expect(state.pod.x).toBeLessThanOrEqual(RELAY_COURSE_WIDTH - RELAY_RULESET.podWidth / 2);
    expect(state.completedTicks).toBe(2);
  });

  it('picks up nodes until capacity and refuses the fourth', () => {
    const state = createRelayState(mission({
      nodes: [0, 1, 2, 3].map((index) => ({ id: `node-${index}`, x: center, y: 100, risk: index % 2 })),
    }));
    stepRelay(state, input(), RELAY_RULESET);
    expect(state.carrying).toBe(RELAY_RULESET.nodeCapacity);
    expect(state.nodes.filter((node) => node.status === 'available')).toHaveLength(1);
  });

  it('banks carried nodes at a relay gate and updates the chain', () => {
    const state = createRelayState(mission({
      nodes: [{ id: 'node-1', x: center, y: 100, risk: 2 }],
      gates: [{ id: 'gate-1', x: center, y: 600 }],
    }));
    stepRelay(state, input(), RELAY_RULESET);
    expect(state.carrying).toBe(1);
    stepRelay(state, input(), RELAY_RULESET);
    expect(state.bankedNodes).toBe(1);
    expect(state.carrying).toBe(0);
    expect(state.bestChain).toBe(1);
    expect(state.riskBonusCount).toBe(2);
  });

  it('damages integrity, drops one carried node, and respects invulnerability', () => {
    const state = createRelayState(mission({
      nodes: [{ id: 'node-1', x: center, y: 100, risk: 0 }],
      hazards: [{ id: 'hazard-1', x: center, y: 600, radius: 100 }],
    }));
    stepRelay(state, input(), RELAY_RULESET);
    expect(state.carrying).toBe(1);
    stepRelay(state, input(), RELAY_RULESET);
    stepRelay(state, input(), RELAY_RULESET);
    expect(state.pod.integrity).toBe(RELAY_RULESET.initialIntegrity - 1);
    expect(state.damageTaken).toBe(1);
    expect(state.carrying).toBe(0);
    expect(state.droppedNodes).toBe(1);
    stepRelay(state, input(), RELAY_RULESET);
    expect(state.damageTaken).toBe(1);
    expect(state.pod.collisionCooldown).toBeGreaterThan(0);
  });

  it('ends immediately at zero integrity and exactly at the tick limit', () => {
    const lethal = createRelayState(mission({
      hazards: [{ id: 'hazard-1', x: center, y: 100, radius: 1_000 }],
    }));
    lethal.pod.integrity = 1;
    stepRelay(lethal, input(), RELAY_RULESET);
    expect(lethal.phase).toBe('finished');
    expect(lethal.completedTicks).toBe(1);

    const timed = createRelayState(mission());
    for (let tick = 0; tick < RELAY_RUN_TICKS; tick += 1) stepRelay(timed, input(), RELAY_RULESET);
    expect(timed.phase).toBe('finished');
    expect(timed.completedTicks).toBe(RELAY_RUN_TICKS);
    stepRelay(timed, input(), RELAY_RULESET);
    expect(timed.completedTicks).toBe(RELAY_RUN_TICKS);
  });

  it('does not mutate mission input objects', () => {
    const source = mission({
      nodes: [{ id: 'node-1', x: center, y: 100, risk: 1 }],
      gates: [{ id: 'gate-1', x: center, y: 200 }],
      hazards: [{ id: 'hazard-1', x: center + 2_000, y: 400, radius: 50 }],
    });
    const before = JSON.stringify(source);
    const state = createRelayState(source);
    stepRelay(state, input(), RELAY_RULESET);
    expect(JSON.stringify(source)).toBe(before);
  });

  it('keeps the empty-course tick hot path within the allocation tolerance', () => {
    const collect = (globalThis as typeof globalThis & { gc?: () => void }).gc;
    for (let warmup = 0; warmup < 10; warmup += 1) {
      const state = createRelayState(mission());
      for (let tick = 0; tick < RELAY_RUN_TICKS; tick += 1) stepRelay(state, input(), RELAY_RULESET);
    }
    collect?.();
    const before = process.memoryUsage().heapUsed;
    const state = createRelayState(mission());
    for (let tick = 0; tick < RELAY_RUN_TICKS; tick += 1) stepRelay(state, input(), RELAY_RULESET);
    collect?.();
    const after = process.memoryUsage().heapUsed;
    expect(after - before).toBeLessThan(8 * 1024 * 1024);
  });
});
