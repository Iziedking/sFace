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
