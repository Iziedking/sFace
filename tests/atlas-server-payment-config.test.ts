import { describe, expect, it } from 'vitest';

import { parseAtlasPaymentConfig, parseAtlasTreasuryConfig } from '../server/atlas/config';

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

/*
 * The reward treasury. createAtlasPayoutService held its ledger in a bare Map
 * and was never constructed in production at all, so nothing could pay a
 * reward and nothing would have survived a restart if it had. It is now
 * reachable, but only behind this gate, because an unpersisted or
 * unsupervised payout path against a funded treasury pays the same reward
 * twice after any redeploy.
 */
describe('NIM Atlas reward treasury configuration', () => {
  const address = `NQ00${'A'.repeat(32)}`;
  const rewardsOn = {
    ATLAS_DURABLE_REPOSITORY_ENABLED: 'true',
    ATLAS_COMPETITIVE_ENABLED: 'true',
    ATLAS_REWARDS_ENABLED: 'true',
    ATLAS_COMPETITIVE_SEASON_ID: 'season-1',
    ATLAS_COMPETITIVE_CHALLENGE_ID: 'expedition-1',
    ATLAS_COMPETITIVE_SEED: 'seed-1',
    ATLAS_COMPETITIVE_CAMPAIGN_HASH: 'a'.repeat(64),
    ATLAS_COMPETITIVE_CURRICULUM_HASH: 'b'.repeat(64),
    ATLAS_COMPETITIVE_RULESET_HASH: 'c'.repeat(64),
  };

  it('stays disabled while rewards are off, even with a treasury address', () => {
    expect(parseAtlasTreasuryConfig({ ATLAS_TREASURY_ADDRESS: address })).toMatchObject({ enabled: false, reason: 'rewards-disabled' });
  });

  it('refuses to enable without a treasury address', () => {
    expect(parseAtlasTreasuryConfig(rewardsOn)).toMatchObject({ enabled: false, reason: 'missing-treasury' });
  });

  it('refuses a treasury address that is not a Nimiq address', () => {
    expect(parseAtlasTreasuryConfig({ ...rewardsOn, ATLAS_TREASURY_ADDRESS: 'NQnope' })).toMatchObject({ enabled: false, reason: 'invalid-treasury' });
  });

  it('enables the treasury with the full owner configuration', () => {
    expect(parseAtlasTreasuryConfig({ ...rewardsOn, ATLAS_TREASURY_ADDRESS: address })).toMatchObject({
      enabled: true,
      reason: null,
      treasuryAddress: address,
    });
  });

  it('requires a durable repository, because the ledger has to outlive a restart', () => {
    const withoutDurable = { ...rewardsOn, ATLAS_DURABLE_REPOSITORY_ENABLED: 'false', ATLAS_TREASURY_ADDRESS: address };
    expect(parseAtlasTreasuryConfig(withoutDurable)).toMatchObject({ enabled: false, reason: 'rewards-disabled' });
  });
});
