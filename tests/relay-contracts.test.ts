import { describe, expect, it } from 'vitest';

import {
  RELAY_MAX_SEGMENTS,
  RELAY_RUN_TICKS,
  RELAY_STEER_MAX,
  RELAY_STEER_MIN,
} from '../shared/relay/constants';
import {
  assertRelayResult,
  assertRelayTrace,
  isIsoUtcDate,
  isSeedCommitment,
  type RelayTrace,
} from '../shared/relay/types';
import {
  RELAY_GOLDEN_FIXTURE,
  RELAY_RULESET,
  scoreGoldenFixture,
} from '../shared/relay/ruleset';

const commitment = 'a'.repeat(64);

function validTrace(overrides: Partial<RelayTrace> = {}): RelayTrace {
  return {
    version: 1,
    ruleset: 'relay-1',
    missionDate: '2026-08-24',
    seedCommitment: commitment,
    ticketId: 'ticket-1',
    segments: [{ startTick: 0, tickCount: RELAY_RUN_TICKS, steerX: 0, flags: 0 }],
    ...overrides,
  };
}

describe('Relay wire contracts', () => {
  it('locks the authoritative run length and segment budget', () => {
    expect(RELAY_RUN_TICKS).toBe(1_350);
    expect(RELAY_MAX_SEGMENTS).toBe(1_350);
  });

  it('accepts integer steering only inside the signed range', () => {
    expect(() => assertRelayTrace(validTrace({
      segments: [{ startTick: 0, tickCount: RELAY_RUN_TICKS, steerX: RELAY_STEER_MIN, flags: 0 }],
    }))).not.toThrow();
    expect(() => assertRelayTrace(validTrace({
      segments: [{ startTick: 0, tickCount: RELAY_RUN_TICKS, steerX: RELAY_STEER_MAX, flags: 0 }],
    }))).not.toThrow();
    expect(() => assertRelayTrace(validTrace({
      segments: [{ startTick: 0, tickCount: RELAY_RUN_TICKS, steerX: RELAY_STEER_MAX + 1, flags: 0 }],
    }))).toThrow(/steerX/);
    expect(() => assertRelayTrace(validTrace({
      segments: [{ startTick: 0, tickCount: RELAY_RUN_TICKS, steerX: 1.5, flags: 0 }],
    }))).toThrow(/integer/);
  });

  it('requires exact contiguous coverage from tick zero through tick 1349', () => {
    expect(() => assertRelayTrace(validTrace())).not.toThrow();
    expect(() => assertRelayTrace(validTrace({
      segments: [{ startTick: 1, tickCount: RELAY_RUN_TICKS, steerX: 0, flags: 0 }],
    }))).toThrow(/coverage/);
    expect(() => assertRelayTrace(validTrace({
      segments: [{ startTick: 0, tickCount: RELAY_RUN_TICKS - 1, steerX: 0, flags: 0 }],
    }))).toThrow(/coverage/);
    expect(() => assertRelayTrace(validTrace({
      segments: [
        { startTick: 0, tickCount: 20, steerX: 0, flags: 0 },
        { startTick: 19, tickCount: RELAY_RUN_TICKS - 19, steerX: 0, flags: 0 },
      ],
    }))).toThrow(/coverage/);
  });

  it('rejects reserved flags and excessive segments', () => {
    expect(() => assertRelayTrace(validTrace({
      segments: [{ startTick: 0, tickCount: RELAY_RUN_TICKS, steerX: 0, flags: 1 }],
    }))).toThrow(/flags/);
    expect(() => assertRelayTrace(validTrace({
      segments: Array.from({ length: RELAY_MAX_SEGMENTS + 1 }, (_, index) => ({
        startTick: index,
        tickCount: 1,
        steerX: 0,
        flags: 0,
      })),
    }))).toThrow(/segments/);
  });

  it('validates UTC dates and lowercase 64-character commitments', () => {
    expect(isIsoUtcDate('2026-08-24')).toBe(true);
    expect(isIsoUtcDate('2026-02-29')).toBe(false);
    expect(isIsoUtcDate('2026-8-24')).toBe(false);
    expect(isSeedCommitment(commitment)).toBe(true);
    expect(isSeedCommitment('A'.repeat(64))).toBe(false);
    expect(isSeedCommitment('a'.repeat(63))).toBe(false);
    expect(() => assertRelayTrace(validTrace({ seedCommitment: 'A'.repeat(64) }))).toThrow(/commitment/);
  });

  it('rejects non-finite or unsafe result values', () => {
    expect(() => assertRelayResult({
      score: Number.MAX_SAFE_INTEGER + 1,
      bankedNodes: 0,
      damageTaken: 0,
      bestChain: 0,
      integrityRemaining: 0,
      completedTicks: 0,
      repairUnits: 0,
    })).toThrow(/safe integer/);
    expect(() => assertRelayResult({
      score: Number.NaN,
      bankedNodes: 0,
      damageTaken: 0,
      bestChain: 0,
      integrityRemaining: 0,
      completedTicks: 0,
      repairUnits: 0,
    })).toThrow(/finite/);
  });

  it('keeps the immutable ruleset and hand-worked fixture arithmetic explicit', () => {
    expect(RELAY_RULESET.version).toBe('relay-1');
    expect(RELAY_GOLDEN_FIXTURE.segments).toHaveLength(5);
    expect(RELAY_GOLDEN_FIXTURE.expected.horizontalDelta).toBe(2_520);
    expect(scoreGoldenFixture()).toEqual({ score: 635, repairUnits: 63 });
  });
});
