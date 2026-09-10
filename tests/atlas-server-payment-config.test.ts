import { describe, expect, it } from 'vitest';

import { parseAtlasPaymentConfig } from '../server/atlas/config';

describe('NIM Atlas server payment configuration', () => {
  it('keeps the live order and reconciliation routes disabled until recipient and RPC are configured', () => {
    expect(parseAtlasPaymentConfig({ ATLAS_TESTNET_ENABLED: 'true', ATLAS_TESTNET_RECIPIENT: `NQ00${'A'.repeat(32)}`, ATLAS_TESTNET_PRICE_LUNA: '100000', ATLAS_TESTNET_RPC_URLS: '' })).toMatchObject({ enabled: false, reason: 'missing-rpc' });
  });

  it('enables the testnet catalog only with exact owner configuration', () => {
    const config = parseAtlasPaymentConfig({ ATLAS_TESTNET_ENABLED: 'true', ATLAS_TESTNET_RECIPIENT: `NQ00${'A'.repeat(32)}`, ATLAS_TESTNET_PRICE_LUNA: '100000', ATLAS_TESTNET_RPC_URLS: 'https://rpc.one,https://rpc.two', ATLAS_TESTNET_MIN_CONFIRMATIONS: '3' });
    expect(config).toMatchObject({ enabled: true, reason: null, recipient: `NQ00${'A'.repeat(32)}`, valueLuna: 100_000, minConfirmations: 3, rpcUrls: ['https://rpc.one', 'https://rpc.two'] });
  });
});

/*
 * Dual network. server/atlas/config.ts hardcoded network: 'testalbatross' in
 * its type and its value, so mainnet was unreachable by configuration even
 * though server/atlas/chain.ts, shop.ts and payouts.ts already understood
 * 'mainalbatross'. ATLAS_NETWORK selects it, and each network carries its own
 * recipient, RPC list and genesis hash so the two can never share either.
 */
describe('NIM Atlas dual network configuration', () => {
  const address = `NQ00${'A'.repeat(32)}`;

  it('defaults to the practice network when ATLAS_NETWORK is unset', () => {
    expect(parseAtlasPaymentConfig({ ATLAS_TESTNET_ENABLED: 'true', ATLAS_TESTNET_RECIPIENT: address, ATLAS_TESTNET_RPC_URLS: 'https://rpc.test' }).network).toBe('testalbatross');
  });

  it('reads mainnet from its own variables, never the testnet ones', () => {
    const config = parseAtlasPaymentConfig({
      ATLAS_NETWORK: 'mainalbatross',
      ATLAS_MAINNET_ENABLED: 'true',
      ATLAS_MAINNET_RECIPIENT: address,
      ATLAS_MAINNET_PRICE_LUNA: '100000',
      ATLAS_MAINNET_RPC_URLS: 'https://rpc.main',
      ATLAS_MAINNET_GENESIS_HASH: 'deadbeef',
      // Present and wrong on purpose. Mainnet must not pick these up.
      ATLAS_TESTNET_RECIPIENT: `NQ99${'B'.repeat(32)}`,
      ATLAS_TESTNET_RPC_URLS: 'https://rpc.test',
    });
    expect(config).toMatchObject({
      enabled: true,
      reason: null,
      network: 'mainalbatross',
      recipient: address,
      rpcUrls: ['https://rpc.main'],
      genesisHash: 'deadbeef',
    });
  });

  it('refuses mainnet without a genesis hash to prove the RPC chain', () => {
    expect(parseAtlasPaymentConfig({
      ATLAS_NETWORK: 'mainalbatross',
      ATLAS_MAINNET_ENABLED: 'true',
      ATLAS_MAINNET_RECIPIENT: address,
      ATLAS_MAINNET_PRICE_LUNA: '100000',
      ATLAS_MAINNET_RPC_URLS: 'https://rpc.main',
    })).toMatchObject({ enabled: false, reason: 'missing-genesis-hash', network: 'mainalbatross' });
  });

  it('rejects an unknown network name rather than guessing one', () => {
    expect(parseAtlasPaymentConfig({ ATLAS_NETWORK: 'ethereum', ATLAS_TESTNET_ENABLED: 'true' })).toMatchObject({ enabled: false, reason: 'unknown-network' });
  });
});
