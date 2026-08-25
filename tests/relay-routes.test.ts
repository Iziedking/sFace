import { describe, expect, it } from 'vitest';

import { parseRelayBody, relayAttemptSchema } from '../server/relay/schemas';
import { createRelayApi } from '../server/relay/routes';
import type { RelayRunRecord } from '../shared/relay/types';

describe('Relay public API boundaries', () => {
  it('returns stable validation errors for malformed and oversized bodies', () => {
    expect(parseRelayBody(relayAttemptSchema, { actorId: 'bad', missionDate: 'not-a-date' })).toEqual({ ok: false, error: 'relay_invalid_body' });
    expect(parseRelayBody(relayAttemptSchema, { actorId: 'a'.repeat(32), missionDate: '2026-08-24' }, 16_385)).toEqual({ ok: false, error: 'relay_body_too_large' });
  });

  it('exposes practice bootstrap honestly when competitive Relay is disabled', async () => {
    const api = createRelayApi({
      config: { enabled: false, competitiveEnabled: false, rewardsEnabled: false, practiceEnabled: true, rewardsDisabledReason: 'missing_reward_configuration', seasonId: 'season-0', network: 'test', treasuryAddress: null, minConfirmations: 10, rpcUrls: [] },
      bootstrap: async () => ({ mode: 'practice', competitive: false }),
    });
    await expect(api.bootstrap()).resolves.toEqual({ mode: 'practice', competitive: false });
  });

  it('returns a privacy-safe verified run status for timeout reconciliation', async () => {
    const record: RelayRunRecord = {
      id: 'run-1', actorId: 'actor-1', ticketId: 'a'.repeat(32), walletAddress: 'NQ00 PRIVATE', missionDate: '2026-08-25', ruleset: 'relay-1', seedCommitment: 'b'.repeat(64), traceHash: 'c'.repeat(64),
      result: { score: 250, bankedNodes: 0, damageTaken: 0, bestChain: 0, integrityRemaining: 3, completedTicks: 1_350, repairUnits: 2 },
      verification: 'verified', receivedAt: 1,
    };
    const api = createRelayApi({
      config: { enabled: true, competitiveEnabled: true, rewardsEnabled: false, practiceEnabled: true, rewardsDisabledReason: 'missing_reward_configuration', seasonId: 'season-0', network: 'test', treasuryAddress: null, minConfirmations: 10, rpcUrls: [] },
      repository: {
        acceptRun: async (run) => run,
        getRun: async (runId) => runId === record.id ? record : null,
        recordPayout: async (payout) => payout,
      },
    });

    await expect(api.runStatus?.('run-1')).resolves.toEqual({
      runId: 'run-1', status: 'verified', missionDate: '2026-08-25', ruleset: 'relay-1', result: record.result, receivedAt: 1,
    });
    await expect(api.runStatus?.('missing')).resolves.toBeNull();
  });
});
