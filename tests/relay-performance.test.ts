import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';

import { generateRelayMission } from '../shared/relay/mission';
import { RELAY_RULESET } from '../shared/relay/ruleset';
import { createRelayState } from '../shared/relay/state';
import { stepRelay } from '../shared/relay/step';
import { encodeRelayTraceCompressed } from '../shared/relay/trace';
import type { RelayTrace } from '../shared/relay/types';

describe('Relay deterministic performance budgets', () => {
  it('runs the authoritative 1,350-tick simulation deterministically within the local headless budget', () => {
    const mission = generateRelayMission('a'.repeat(64), RELAY_RULESET);
    const first = createRelayState(mission);
    const second = createRelayState(mission);
    const start = performance.now();
    for (let tick = 0; tick < RELAY_RULESET.runTicks; tick += 1) {
      const input = { steerX: tick % 3 === 0 ? 35 : -20, flags: 0 } as const;
      stepRelay(first, input, RELAY_RULESET);
      stepRelay(second, input, RELAY_RULESET);
    }
    const elapsed = performance.now() - start;
    expect(first).toEqual(second);
    expect(first.completedTicks).toBe(RELAY_RULESET.runTicks);
    expect(elapsed).toBeLessThan(2_000);
  });

  it('keeps a typical compressed trace below the 32 KiB sharing target', () => {
    const trace: RelayTrace = {
      version: 1,
      ruleset: RELAY_RULESET.version,
      missionDate: '2026-08-24',
      seedCommitment: 'a'.repeat(64),
      ticketId: 'ticket-1',
      segments: [{ startTick: 0, tickCount: 1_350, steerX: 0, flags: 0 }],
    };
    expect(encodeRelayTraceCompressed(trace).byteLength).toBeLessThan(32 * 1024);
  });
});
