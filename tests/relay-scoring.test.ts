import { describe, expect, it } from 'vitest';

import { assertRelayResult } from '../shared/relay/types';
import { createRelayState } from '../shared/relay/state';
import { deriveRelayResult } from '../shared/relay/score';
import { RELAY_RULESET } from '../shared/relay/ruleset';

describe('Relay integer scoring', () => {
  it('derives each score component and caps repair units', () => {
    const state = createRelayState({ seedHex: '01'.repeat(32), ruleset: 'relay-1', nodes: [], gates: [], hazards: [], sections: [] });
    state.bankedNodes = 3;
    state.riskBonusCount = 2;
    state.bestChain = 3;
    state.damageTaken = 0;
    state.pod.integrity = 3;
    state.completedTicks = RELAY_RULESET.runTicks;

    const result = deriveRelayResult(state, RELAY_RULESET);

    expect(result).toEqual({
      score: 635,
      bankedNodes: 3,
      damageTaken: 0,
      bestChain: 3,
      integrityRemaining: 3,
      completedTicks: 1_350,
      repairUnits: 63,
    });
    expect(() => assertRelayResult(result)).not.toThrow();
  });

  it('omits the no-damage bonus after a collision and never emits unsafe values', () => {
    const state = createRelayState({ seedHex: '01'.repeat(32), ruleset: 'relay-1', nodes: [], gates: [], hazards: [], sections: [] });
    state.bankedNodes = 1;
    state.damageTaken = 1;
    state.pod.integrity = 2;
    state.completedTicks = 30;
    const result = deriveRelayResult(state, RELAY_RULESET);
    expect(result.score).toBe(100 + 2 * 50);
    expect(result.repairUnits).toBe(20);
    expect(Number.isSafeInteger(result.score)).toBe(true);
  });

  it('is deterministic across repeated terminal derivations', () => {
    const state = createRelayState({ seedHex: '01'.repeat(32), ruleset: 'relay-1', nodes: [], gates: [], hazards: [], sections: [] });
    state.bankedNodes = 2;
    state.riskBonusCount = 1;
    state.bestChain = 2;
    state.pod.integrity = 1;
    state.damageTaken = 2;
    state.completedTicks = 1_350;
    const expected = deriveRelayResult(state, RELAY_RULESET);
    for (let repeat = 0; repeat < 1_000; repeat += 1) {
      expect(deriveRelayResult(state, RELAY_RULESET)).toEqual(expected);
    }
  });
});
