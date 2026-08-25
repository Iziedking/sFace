import { describe, expect, it } from 'vitest';

import { generateRelayMission } from '../shared/relay/mission';
import { RELAY_RULESET } from '../shared/relay/ruleset';
import { hashRelayTrace } from '../shared/relay/trace';
import { RelayVerifier } from '../server/relay/verifier';
import { assertRelayTrace } from '../shared/relay/types';

const mission = { ...generateRelayMission('02'.repeat(32), RELAY_RULESET), missionDate: '2026-08-24', seedCommitment: 'b'.repeat(64) };
const valid = {
  version: 1 as const,
  ruleset: 'relay-1' as const,
  missionDate: '2026-08-24',
  seedCommitment: 'b'.repeat(64),
  ticketId: 'ticket-1',
  segments: [{ startTick: 0, tickCount: 1_350, steerX: 0, flags: 0 }],
};

describe('Relay adversarial traces', () => {
  it('rejects skipped ticks, duplicate coverage, illegal steering, flags, and oversized segments', () => {
    expect(() => assertRelayTrace({ ...valid, segments: [{ startTick: 1, tickCount: 1_350, steerX: 0, flags: 0 }] })).toThrow(/coverage/);
    expect(() => assertRelayTrace({ ...valid, segments: [
      { startTick: 0, tickCount: 10, steerX: 0, flags: 0 },
      { startTick: 9, tickCount: 1_341, steerX: 0, flags: 0 },
    ] })).toThrow(/coverage/);
    expect(() => assertRelayTrace({ ...valid, segments: [{ startTick: 0, tickCount: 1_350, steerX: 128, flags: 0 }] })).toThrow(/steerX/);
    expect(() => assertRelayTrace({ ...valid, segments: [{ startTick: 0, tickCount: 1_350, steerX: 0, flags: 1 }] })).toThrow(/flags/);
    expect(() => assertRelayTrace({ ...valid, segments: Array.from({ length: 1_351 }, (_, index) => ({ startTick: index, tickCount: 1, steerX: 0, flags: 0 })) })).toThrow(/segments/);
  });

  it('rejects a trace hash reused by another actor', async () => {
    const verifier = new RelayVerifier();
    await expect(verifier.verify({ actorId: 'actor-a', mission, trace: valid, ruleset: RELAY_RULESET })).resolves.toMatchObject({ ok: true });
    await expect(verifier.verify({ actorId: 'actor-b', mission, trace: valid, ruleset: RELAY_RULESET })).resolves.toMatchObject({
      ok: false,
      error: 'trace_reused_by_another_actor',
    });
  });

  it('rejects altered trace bytes presented with the original hash', async () => {
    const verifier = new RelayVerifier();
    const expectedTraceHash = await hashRelayTrace(valid);
    const altered = { ...valid, segments: [{ startTick: 0, tickCount: 1_350, steerX: 1, flags: 0 }] };
    await expect(verifier.verify({ actorId: 'actor-a', mission, trace: altered, ruleset: RELAY_RULESET, expectedTraceHash })).resolves.toEqual({
      ok: false,
      error: 'invalid_trace',
    });
  });
});
