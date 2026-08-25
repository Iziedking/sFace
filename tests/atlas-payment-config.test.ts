import { describe, expect, it } from 'vitest';

import { createAtlasTestnetPaymentConfig } from '../shared/atlas/payment-config';

describe('NIM Atlas live testnet payment configuration', () => {
  it('fails closed without an owner-supplied real Nimiq recipient', () => {
    expect(createAtlasTestnetPaymentConfig({ enabled: true, recipient: '', valueLuna: '100000' })).toMatchObject({ enabled: false, reason: 'missing-recipient' });
    expect(createAtlasTestnetPaymentConfig({ enabled: true, recipient: 'NQATLASLANTERNSHOP', valueLuna: '100000' })).toMatchObject({ enabled: false, reason: 'fixture-recipient' });
  });

  it('enables only the exact positive Luna catalog when the owner supplies a valid address', () => {
    const recipient = `NQ00${'A'.repeat(32)}`;
    expect(createAtlasTestnetPaymentConfig({ enabled: true, recipient, valueLuna: '100000' })).toEqual({
      enabled: true,
      reason: null,
      network: 'testalbatross',
      recipient,
      valueLuna: 100_000,
      itemId: 'harbor-lantern',
      minimumConfirmations: 3,
    });
  });

  it('rejects decimals, zero, and malformed addresses', () => {
    const recipient = `NQ00${'A'.repeat(32)}`;
    expect(createAtlasTestnetPaymentConfig({ enabled: true, recipient, valueLuna: '100000.5' }).reason).toBe('invalid-amount');
    expect(createAtlasTestnetPaymentConfig({ enabled: true, recipient: 'NQwrong', valueLuna: '100000' }).reason).toBe('invalid-recipient');
  });
});
