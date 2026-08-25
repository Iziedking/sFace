import { describe, expect, it } from 'vitest';

import { ATLAS_DAILY_CHALLENGES, validateDailyManifest } from '../shared/atlas/daily';
import { createAtlasDailyService } from '../server/atlas/daily';

describe('NIM Atlas daily applied challenges', () => {
  it('ships exactly 28 source-reviewed challenges across four learning themes', () => {
    const manifest = validateDailyManifest(ATLAS_DAILY_CHALLENGES, new Date('2026-08-25T12:00:00.000Z'));
    expect(manifest).toHaveLength(28);
    expect(new Set(manifest.map((item) => item.theme))).toEqual(new Set(['money', 'permission', 'evidence', 'network']));
    expect(new Set(manifest.map((item) => item.id)).size).toBe(28);
    expect(manifest.every((item) => item.source.url.startsWith('https://nimiq.dev/'))).toBe(true);
  });

  it('accepts one unassisted correct solve and makes duplicate retry idempotent', async () => {
    const service = createAtlasDailyService({ date: () => '2026-08-25' });
    const input = { actorId: 'actor-1', walletAddress: 'NQwallet', challengeId: 'daily-01', answer: '1200000', replayComplete: true, assistance: 'none' as const };
    await expect(service.submit(input)).resolves.toMatchObject({ accepted: true, eligible: true });
    await expect(service.submit(input)).resolves.toMatchObject({ accepted: true, eligible: true, duplicate: true });
  });

  it('rejects payment substitutions, hash-only evidence, stale consensus, concentrated validators, and device-only identity', async () => {
    const service = createAtlasDailyService({ date: () => '2026-08-25' });
    await expect(service.submit({ actorId: 'actor-2', walletAddress: 'NQwallet', challengeId: 'daily-05', answer: '100000', replayComplete: true, assistance: 'none', payment: { network: 'testalbatross', recipient: 'NQwrong', valueLuna: 100_000, canonical: true, success: true, confirmations: 3 } })).resolves.toMatchObject({ accepted: false, reason: 'payment_mismatch' });
    await expect(service.submit({ actorId: 'actor-3', walletAddress: 'NQwallet', challengeId: 'daily-05', answer: '100000', replayComplete: true, assistance: 'none', payment: { txHash: 'hash-only' } })).resolves.toMatchObject({ accepted: false, reason: 'payment_unverified' });
    await expect(service.submit({ actorId: 'actor-4', walletAddress: 'NQwallet', challengeId: 'daily-09', answer: 'retry', replayComplete: true, assistance: 'none', consensus: { established: true, observedAt: 1 } })).resolves.toMatchObject({ accepted: false, reason: 'consensus_stale' });
    await expect(service.submit({ actorId: 'actor-5', walletAddress: 'NQwallet', challengeId: 'daily-13', answer: 'distributed', replayComplete: true, assistance: 'none', validatorDistribution: { distinctValidators: 1, totalValidators: 10 } })).resolves.toMatchObject({ accepted: false, reason: 'validator_concentration' });
    await expect(service.submit({ walletAddress: 'NQwallet', deviceIdentifier: 'device-1', challengeId: 'daily-01', answer: '1200000', replayComplete: true, assistance: 'none' } as never)).resolves.toMatchObject({ accepted: false, reason: 'identity_required' });
  });

  it('keeps cancellation and incomplete replay recoverable without creating eligibility', async () => {
    const service = createAtlasDailyService({ date: () => '2026-08-25' });
    await expect(service.submit({ actorId: 'actor-6', walletAddress: 'NQwallet', challengeId: 'daily-05', answer: '100000', replayComplete: false, assistance: 'none', recovery: 'wallet-cancelled' })).resolves.toMatchObject({ accepted: false, reason: 'replay_incomplete', retryable: true });
  });

  it('exposes an estimate before close and a pending obligation after acceptance', async () => {
    const service = createAtlasDailyService({ date: () => '2026-08-25' });
    expect(service.estimateShare(3)).toEqual(26_666_666);
    await service.submit({ actorId: 'actor-7', walletAddress: 'NQwallet', challengeId: 'daily-01', answer: '1200000', replayComplete: true, assistance: 'none' });
    await expect(service.pendingObligation({ actorId: 'actor-7', walletAddress: 'NQwallet', challengeId: 'daily-01' })).resolves.toEqual({ status: 'pending-close', amountLuna: null });
  });
});
