import { describe, expect, it } from 'vitest';

import { createAtlasPaymentConfig, createAtlasTestnetPaymentConfig } from '../shared/atlas/payment-config';

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

/*
 * Mainnet moves real NIM, so it may not run on an RPC whose chain has never
 * been proved. server/atlas/chain.ts fingerprints the chain by its genesis
 * block hash, and without an expected hash to compare against, a mainnet
 * config and a testnet RPC satisfy every downstream guard because both sides
 * read the same configured network string.
 *
 * Practice networks stay permissive on purpose: no real value moves there, and
 * requiring the extra setup would push people off the wallet-free path.
 */
describe('NIM Atlas payment network configuration', () => {
  const recipient = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000'.replace(/ /g, '');

  it('refuses mainnet when no genesis hash proves which chain the RPC is on', () => {
    expect(createAtlasPaymentConfig({ network: 'mainalbatross', enabled: true, recipient, valueLuna: '100000' })).toMatchObject({
      enabled: false,
      reason: 'missing-genesis-hash',
      network: 'mainalbatross',
    });
  });

  it('enables mainnet once a genesis hash is supplied', () => {
    expect(createAtlasPaymentConfig({ network: 'mainalbatross', enabled: true, recipient, valueLuna: '100000', genesisHash: 'abc123' })).toMatchObject({
      enabled: true,
      reason: null,
      network: 'mainalbatross',
      genesisHash: 'abc123',
    });
  });

  it('leaves practice networks enabled without a genesis hash', () => {
    expect(createAtlasPaymentConfig({ network: 'testalbatross', enabled: true, recipient, valueLuna: '100000' })).toMatchObject({
      enabled: true,
      reason: null,
      network: 'testalbatross',
    });
  });

  it('still refuses a fixture recipient on mainnet, before reaching the genesis check', () => {
    expect(createAtlasPaymentConfig({ network: 'mainalbatross', enabled: true, recipient: 'NQATLASLANTERNSHOP', valueLuna: '100000', genesisHash: 'abc123' }).reason).toBe('fixture-recipient');
  });

  it('keeps the testnet helper behaving as before', () => {
    expect(createAtlasTestnetPaymentConfig({ enabled: true, recipient, valueLuna: '100000' })).toMatchObject({ enabled: true, network: 'testalbatross' });
  });
});
