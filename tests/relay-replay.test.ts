import { describe, expect, it } from 'vitest';

import { generateRelayMission } from '../shared/relay/mission';
import { replayRelayTrace } from '../shared/relay/replay';
import { RELAY_RULESET } from '../shared/relay/ruleset';
import type { RelayTrace } from '../shared/relay/types';

const mission = generateRelayMission('01'.repeat(32), RELAY_RULESET);
const valid: RelayTrace = {
  version: 1,
  ruleset: 'relay-1',
  missionDate: '2026-08-24',
  seedCommitment: 'a'.repeat(64),
  ticketId: 'ticket-1',
  segments: [{ startTick: 0, tickCount: 1_350, steerX: 0, flags: 0 }],
};

describe('Relay full replay', () => {
  it('replays exactly 1,350 ticks through the authoritative step function', () => {
    const result = replayRelayTrace(mission, valid, RELAY_RULESET);
    expect(result.completedTicks).toBe(1_350);
    expect(result.score).toBe(250);
  });

  it('rejects a forged client summary when it differs from replay output', () => {
    const honest = replayRelayTrace(mission, valid, RELAY_RULESET);
    expect(() => replayRelayTrace(mission, valid, RELAY_RULESET, { ...honest, score: honest.score + 1 })).toThrow(/summary|replay|score/i);
  });

  it('binds replay to the mission date, ruleset, and commitment when supplied', () => {
    const contextualMission = { ...mission, missionDate: '2026-08-24', seedCommitment: 'a'.repeat(64) };
    expect(() => replayRelayTrace(contextualMission, valid, RELAY_RULESET)).not.toThrow();
    expect(() => replayRelayTrace({ ...contextualMission, missionDate: '2026-08-25' }, valid, RELAY_RULESET)).toThrow(/date/i);
    expect(() => replayRelayTrace({ ...contextualMission, seedCommitment: 'b'.repeat(64) }, valid, RELAY_RULESET)).toThrow(/commitment/i);
    expect(() => replayRelayTrace(contextualMission, { ...valid, ruleset: 'old' as 'relay-1' }, RELAY_RULESET)).toThrow(/ruleset/i);
  });
});
