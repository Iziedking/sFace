import { describe, expect, it } from 'vitest';

import { ATLAS_DAILY_CHALLENGES, validateDailyManifest } from '../shared/atlas/daily';
import { createAtlasDailyService, type AtlasDailyPaymentExpectation } from '../server/atlas/daily';

/*
 * The payment guard now checks the server's configured recipient and amount
 * rather than the fixture literals it used to carry, so every construction
 * supplies what production would.
 */
const EXPECTATION: AtlasDailyPaymentExpectation = {
  network: 'testalbatross',
  recipient: 'NQ07ABCDEFGHJKLMNPQRSTUVXY0123456789',
  valueLuna: 10_000,
  minimumConfirmations: 3,
};

describe('NIM Atlas daily applied challenges', () => {
  it('ships exactly 28 source-reviewed challenges across four learning themes', () => {
    const manifest = validateDailyManifest(ATLAS_DAILY_CHALLENGES, new Date('2026-08-25T12:00:00.000Z'));
    expect(manifest).toHaveLength(28);
    expect(new Set(manifest.map((item) => item.theme))).toEqual(new Set(['money', 'permission', 'evidence', 'network']));
    expect(new Set(manifest.map((item) => item.id)).size).toBe(28);
    expect(manifest.every((item) => item.source.url.startsWith('https://nimiq.dev/'))).toBe(true);
  });

  it('accepts one unassisted correct solve and makes duplicate retry idempotent', async () => {
    const service = createAtlasDailyService({ date: () => '2026-08-25', expectation: EXPECTATION });
    const input = { actorId: 'actor-1', walletAddress: 'NQwallet', challengeId: 'daily-01', answer: '1200000', replayComplete: true, assistance: 'none' as const };
    await expect(service.submit(input)).resolves.toMatchObject({ accepted: true, eligible: true });
    await expect(service.submit(input)).resolves.toMatchObject({ accepted: true, eligible: true, duplicate: true });
  });

  it('rejects payment substitutions, hash-only evidence, stale consensus, concentrated validators, and device-only identity', async () => {
    const service = createAtlasDailyService({ date: () => '2026-08-25', expectation: EXPECTATION });
    await expect(service.submit({ actorId: 'actor-2', walletAddress: 'NQwallet', challengeId: 'daily-05', answer: '100000', replayComplete: true, assistance: 'none', payment: { network: 'testalbatross', recipient: 'NQwrong', valueLuna: 100_000, canonical: true, success: true, confirmations: 3 } })).resolves.toMatchObject({ accepted: false, reason: 'payment_mismatch' });
    await expect(service.submit({ actorId: 'actor-3', walletAddress: 'NQwallet', challengeId: 'daily-05', answer: '100000', replayComplete: true, assistance: 'none', payment: { txHash: 'hash-only' } })).resolves.toMatchObject({ accepted: false, reason: 'payment_unverified' });
    await expect(service.submit({ actorId: 'actor-4', walletAddress: 'NQwallet', challengeId: 'daily-09', answer: 'retry', replayComplete: true, assistance: 'none', consensus: { established: true, observedAt: 1 } })).resolves.toMatchObject({ accepted: false, reason: 'consensus_stale' });
    await expect(service.submit({ actorId: 'actor-5', walletAddress: 'NQwallet', challengeId: 'daily-13', answer: 'distributed', replayComplete: true, assistance: 'none', validatorDistribution: { distinctValidators: 1, totalValidators: 10 } })).resolves.toMatchObject({ accepted: false, reason: 'validator_concentration' });
    await expect(service.submit({ walletAddress: 'NQwallet', deviceIdentifier: 'device-1', challengeId: 'daily-01', answer: '1200000', replayComplete: true, assistance: 'none' } as never)).resolves.toMatchObject({ accepted: false, reason: 'identity_required' });
  });

  it('keeps cancellation and incomplete replay recoverable without creating eligibility', async () => {
    const service = createAtlasDailyService({ date: () => '2026-08-25', expectation: EXPECTATION });
    await expect(service.submit({ actorId: 'actor-6', walletAddress: 'NQwallet', challengeId: 'daily-05', answer: '100000', replayComplete: false, assistance: 'none', recovery: 'wallet-cancelled' })).resolves.toMatchObject({ accepted: false, reason: 'replay_incomplete', retryable: true });
  });

  it('exposes an estimate before close and a pending obligation after acceptance', async () => {
    /*
     * The estimate used to be 80,000,000 Luna divided by the field, returned
     * whether or not a treasury existed, so an unfunded day still quoted a
     * share. It is null unless a pot is configured, and split from that pot
     * when one is.
     */
    const unfunded = createAtlasDailyService({ date: () => '2026-08-25', expectation: EXPECTATION });
    expect(unfunded.estimateShare(3)).toBeNull();

    const service = createAtlasDailyService({ date: () => '2026-08-25', expectation: EXPECTATION, dailyPoolLuna: 80_000_000 });
    expect(service.estimateShare(3)).toEqual(26_666_666);
    await service.submit({ actorId: 'actor-7', walletAddress: 'NQwallet', challengeId: 'daily-01', answer: '1200000', replayComplete: true, assistance: 'none' });
    /*
     * The obligation now carries what is actually owed. It used to be null
     * always, so nothing could tell a qualifying player what their share was
     * until the day closed, and nothing could tell the treasury what it had
     * committed. With one wallet eligible the whole pot is owed to it.
     */
    await expect(service.pendingObligation({ actorId: 'actor-7', walletAddress: 'NQwallet', challengeId: 'daily-01' })).resolves.toEqual({ status: 'pending-close', amountLuna: 80_000_000 });
    await expect(unfunded.pendingObligation({ actorId: 'actor-7', walletAddress: 'NQwallet', challengeId: 'daily-01' })).resolves.toEqual({ status: 'not-eligible', amountLuna: null });
  });

  it('keeps one daily eligibility effect under one hundred concurrent duplicate solves', async () => {
    const service = createAtlasDailyService({ date: () => '2026-08-25', expectation: EXPECTATION });
    const input = { actorId: 'actor-concurrent', walletAddress: 'NQwallet', challengeId: 'daily-01', answer: '1200000', replayComplete: true, assistance: 'none' as const };
    const results = await Promise.all(Array.from({ length: 100 }, () => service.submit(input)));
    expect(results.every((result) => result.accepted && result.eligible)).toBe(true);
    expect(results.filter((result) => result.duplicate !== true)).toHaveLength(1);
  });
});
