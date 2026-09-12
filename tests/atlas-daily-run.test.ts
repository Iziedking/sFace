import { describe, expect, it } from 'vitest';
import { createAtlasDailyService, type AtlasDailyPaymentExpectation } from '../server/atlas/daily';
import { ATLAS_DAILY_CHALLENGES } from '../shared/atlas/daily';

const WALLET = 'NQ07ABCDEFGHJKLMNPQRSTUVXY0123456789';
const OTHER_WALLET = 'NQ07ABCDEFGHJKLMNPQRSTUVXY0123456788';
const DATE = '2026-09-12';

/** Production's shape: a real recipient at 10,000 Luna, not the fixture. */
const EXPECTATION: AtlasDailyPaymentExpectation = {
  network: 'testalbatross',
  recipient: WALLET,
  valueLuna: 10_000,
  minimumConfirmations: 3,
};

const paymentChallenge = ATLAS_DAILY_CHALLENGES.find((challenge) => challenge.guard === 'payment')!;
const plainChallenge = ATLAS_DAILY_CHALLENGES.find((challenge) => challenge.guard === 'none')!;

function service(overrides: Partial<Parameters<typeof createAtlasDailyService>[0]> = {}) {
  return createAtlasDailyService({ date: () => DATE, now: () => Date.parse(`${DATE}T12:00:00Z`), expectation: EXPECTATION, ...overrides });
}

function goodPayment() {
  return { network: 'testalbatross', recipient: WALLET, valueLuna: 10_000, canonical: true, success: true, confirmations: 5 };
}

function submission(extra: Record<string, unknown> = {}) {
  return {
    actorId: 'atlas-session-aaa',
    walletAddress: WALLET,
    challengeId: paymentChallenge.id,
    answer: paymentChallenge.answer,
    replayComplete: true,
    assistance: 'none' as const,
    payment: goodPayment(),
    ...extra,
  };
}

describe('the daily run', () => {
  /*
   * The engine shipped comparing against the fixture address
   * NQATLASLANTERNSHOP at 100,000 Luna, while production runs a real recipient
   * at 10,000. It would therefore have refused every genuine payment and
   * accepted only a fixture production cannot produce. The expectation now
   * comes from the server's own payment config, and this is the test that says
   * so in both directions.
   */
  it('refuses the old fixture payment and accepts the configured one', async () => {
    const daily = service();
    const fixture = await daily.submit(submission({
      payment: { network: 'testalbatross', recipient: 'NQATLASLANTERNSHOP', valueLuna: 100_000, canonical: true, success: true, confirmations: 5 },
    }));
    expect(fixture).toMatchObject({ accepted: false, reason: 'payment_mismatch' });
    expect(await daily.submit(submission())).toMatchObject({ accepted: true, eligible: true });
  });

  it('treats a hash with nothing verified beside it as unverified, not as proof', async () => {
    const daily = service();
    const result = await daily.submit(submission({ payment: { txHash: '0xabc123', network: 'testalbatross' } }));
    expect(result).toMatchObject({ accepted: false, reason: 'payment_unverified' });
  });

  it('refuses a payment that is real but not yet confirmed enough', async () => {
    const daily = service();
    const result = await daily.submit(submission({ payment: { ...goodPayment(), confirmations: 2 } }));
    expect(result).toMatchObject({ accepted: false, reason: 'payment_unverified' });
  });

  it('refuses a non-canonical payment even when it says success', async () => {
    const daily = service();
    expect(await daily.submit(submission({ payment: { ...goodPayment(), canonical: false } }))).toMatchObject({ reason: 'payment_unverified' });
  });

  it('counts a wallet once however many times it submits', async () => {
    const daily = service();
    // toMatchObject treats an undefined value as "any", so the absence of the
    // flag is asserted directly rather than through a matcher that passes on
    // a duplicate too.
    expect((await daily.submit(submission())).duplicate).toBeUndefined();
    expect(await daily.submit(submission())).toMatchObject({ duplicate: true, eligible: true });
    expect((await daily.standing()).eligibleCount).toBe(1);
  });

  it('counts one wallet once even when two actors drive it', async () => {
    // Otherwise one funded wallet farms a share per browser profile.
    const daily = service();
    await daily.submit(submission());
    await daily.submit(submission({ actorId: 'atlas-session-bbb' }));
    expect((await daily.standing()).eligibleCount).toBe(1);
  });

  describe('what it says about rewards', () => {
    it('never advertises a share when no treasury is funded', async () => {
      const daily = service();
      await daily.submit(submission());
      const standing = await daily.standing();
      expect(standing).toMatchObject({ rewardsEnabled: false, poolLuna: null, shareLuna: null });
      expect(await daily.pendingObligation({ actorId: 'atlas-session-aaa', walletAddress: WALLET, challengeId: paymentChallenge.id }))
        .toMatchObject({ status: 'pending-close', amountLuna: null });
    });

    it('splits the pot in integer Luna, and never over-commits it', async () => {
      const daily = service({ dailyPoolLuna: 100_001 });
      await daily.submit(submission());
      await daily.submit(submission({ actorId: 'atlas-session-bbb', walletAddress: OTHER_WALLET, payment: { ...goodPayment(), recipient: WALLET } }));
      const standing = await daily.standing();
      expect(standing.eligibleCount).toBe(2);
      // Floored, so two shares are 100,000 against a 100,001 pot. The remainder
      // stays with the treasury rather than being owed to nobody.
      expect(standing.shareLuna).toBe(50_000);
      expect(standing.shareLuna! * standing.eligibleCount).toBeLessThanOrEqual(standing.poolLuna!);
    });
  });

  describe('eligibility survives a restart', () => {
    /*
     * It used to live in a bare Set. A restart made every wallet that had
     * already qualified today able to qualify again, which on a service that
     * owes real NIM at the close of the day is a double payment. Same shape as
     * the treasury bug recorded in payouts.ts.
     */
    it('remembers who already qualified today', async () => {
      const store: Record<string, unknown> = {};
      const stateStore = {
        load: async <T>(key: string, fallback: T) => (key in store ? (store[key] as T) : fallback),
        save: async <T>(key: string, value: T) => { store[key] = value; },
      };
      const first = service({ stateStore });
      await first.submit(submission());
      expect((await first.standing()).eligibleCount).toBe(1);

      const afterRestart = service({ stateStore });
      expect((await afterRestart.standing()).eligibleCount).toBe(1);
      expect(await afterRestart.submit(submission())).toMatchObject({ duplicate: true });
    });
  });

  it('still refuses the obvious cheats', async () => {
    const daily = service();
    expect(await daily.submit(submission({ answer: 'not-the-answer' }))).toMatchObject({ reason: 'wrong_answer' });
    expect(await daily.submit(submission({ assistance: 'answer-reveal' }))).toMatchObject({ reason: 'assistance_used' });
    expect(await daily.submit(submission({ replayComplete: false }))).toMatchObject({ reason: 'replay_incomplete', retryable: true });
    expect(await daily.submit(submission({ walletAddress: undefined }))).toMatchObject({ reason: 'identity_required' });
    expect(await daily.submit(submission({ challengeId: 'daily-99' }))).toMatchObject({ reason: 'unknown_challenge' });
  });

  it('does not demand payment evidence from a challenge that has no payment guard', async () => {
    const daily = service();
    const result = await daily.submit({
      actorId: 'atlas-session-aaa',
      walletAddress: WALLET,
      challengeId: plainChallenge.id,
      answer: plainChallenge.answer,
      replayComplete: true,
      assistance: 'none',
    });
    expect(result).toMatchObject({ accepted: true, eligible: true });
  });

  it('lists the wallets a close would have to pay', async () => {
    const daily = service({ dailyPoolLuna: 60_000 });
    await daily.submit(submission());
    await daily.submit(submission({ actorId: 'atlas-session-bbb', walletAddress: OTHER_WALLET }));
    expect([...(await daily.eligibleWallets())]).toEqual([OTHER_WALLET, WALLET].sort());
  });
});
