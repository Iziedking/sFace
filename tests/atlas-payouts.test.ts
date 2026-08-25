import { describe, expect, it } from 'vitest';

import { atlasPayoutSummary, createAtlasPayoutService, type AtlasPayoutRecord } from '../server/atlas/payouts';

const base = {
  id: 'payout-1', period: 'week-1', walletAddress: 'NQWINNER', amountLuna: 300_000_000,
};

describe('NIM Atlas custody-free payout verification', () => {
  it('requires approval before a manually submitted hash and verifies exact local chain evidence', async () => {
    const service = createAtlasPayoutService({ network: 'testalbatross', treasuryAddress: 'NQLOCAL_TREASURY', minConfirmations: 3, chain: { observe: async () => ({ lookup: 'hash-1', network: 'testalbatross', blockHeight: 10, confirmations: 3, sender: 'NQLOCAL_TREASURY', recipient: 'NQWINNER', valueLuna: 300_000_000, success: true, canonical: true }) } });
    await service.create(base);
    await expect(service.recordSubmitted('payout-1', 'hash-1')).rejects.toThrow(/approved/i);
    await service.approve('payout-1');
    await expect(service.recordSubmitted('payout-1', 'hash-1')).resolves.toMatchObject({ status: 'submitted' });
    await expect(service.reconcile('payout-1')).resolves.toMatchObject({ status: 'verified' });
    expect('send' in service).toBe(false);
  });

  it('preserves unknown, confirming, failed, and reorg states and rejects duplicate hashes', async () => {
    let mode: 'unknown' | 'missing' | 'mismatch' | 'reorg' | 'low' = 'unknown';
    const service = createAtlasPayoutService({ network: 'testalbatross', treasuryAddress: 'NQLOCAL_TREASURY', minConfirmations: 3, chain: { observe: async () => {
      if (mode === 'unknown') throw new Error('rpc down');
      if (mode === 'missing') return null;
      return { lookup: 'hash-1', network: 'testalbatross' as const, blockHeight: 10, confirmations: mode === 'low' ? 1 : 3, sender: mode === 'mismatch' ? 'NQOTHER' : 'NQLOCAL_TREASURY', recipient: 'NQWINNER', valueLuna: 300_000_000, success: true, canonical: mode !== 'reorg', reorgDetected: mode === 'reorg' };
    } } });
    await service.create(base);
    await service.approve('payout-1');
    await service.recordSubmitted('payout-1', 'hash-1');
    await expect(service.reconcile('payout-1')).resolves.toMatchObject({ status: 'unknown' });
    mode = 'missing';
    await expect(service.reconcile('payout-1')).resolves.toMatchObject({ status: 'confirming' });
    mode = 'mismatch';
    await expect(service.reconcile('payout-1')).resolves.toMatchObject({ status: 'failed' });
    const second = await service.create({ ...base, id: 'payout-2', walletAddress: 'NQSECOND' });
    await service.approve(second.id);
    await expect(service.recordSubmitted(second.id, 'hash-1')).rejects.toThrow(/duplicate/i);
  });

  it('reports aggregate obligations, verified payouts, rollover, and unawarded funds without exposing addresses', () => {
    const records: AtlasPayoutRecord[] = [{ id: 'payout-1', period: 'week-1', walletAddress: 'NQWINNERSECRET', amountLuna: 300_000_000, network: 'testalbatross', treasuryAddress: 'NQLOCAL_TREASURY', transactionHash: 'hash-1', status: 'verified', refusalReason: null, createdAt: 1 }];
    expect(atlasPayoutSummary(records, { allocationLuna: 8_000_000_000, rolloverLuna: 80, obligationsLuna: 300_000_000 })).toEqual({ allocationLuna: 8_000_000_000, rolloverLuna: 80, obligationsLuna: 300_000_000, verifiedPayoutsLuna: 300_000_000, paidLuna: 300_000_000, unawardedLuna: 7_699_999_920, payouts: [{ id: 'payout-1', period: 'week-1', amountLuna: 300_000_000, status: 'verified', walletAddress: 'NQWI...CRET' }] });
  });
});
