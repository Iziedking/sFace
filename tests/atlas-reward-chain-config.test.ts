import { describe, expect, it } from 'vitest';
import { parseAtlasRewardMinConfirmations, parseAtlasRewardRpcUrls } from '../server/atlas/config';

const mainnetRewards = {
  ATLAS_DAILY_REWARDS_ENABLED: 'true',
  ATLAS_DURABLE_REPOSITORY_ENABLED: 'true',
  ATLAS_TREASURY_ADDRESS: 'NQ21YC9EFUGGC7LN172X3877CF7AVEJB78EF',
  ATLAS_DAILY_POOL_LUNA: '10000',
  ATLAS_REWARD_NETWORK: 'mainalbatross',
  ATLAS_MAINNET_GENESIS_HASH: '968f7ad96731644edd4949961ae186ae832ddbb79284db1069799d66ae5bfd06',
  ATLAS_MAINNET_RPC_URLS: 'https://rpc.example-main.test',
  ATLAS_TESTNET_RPC_URLS: 'https://rpc.example-test.test',
};

describe('the reward chain', () => {
  /*
   * Purchases settle on testnet and daily rewards are paid in real mainnet
   * NIM. The payout path used to borrow the purchase network's chain reader,
   * which would have verified a mainnet payout against a practice chain and
   * called it settled.
   */
  it('reads the reward network\'s own endpoints, never the purchase network\'s', () => {
    expect(parseAtlasRewardRpcUrls(mainnetRewards)).toEqual(['https://rpc.example-main.test']);
    expect(parseAtlasRewardRpcUrls({ ...mainnetRewards, ATLAS_REWARD_NETWORK: 'testalbatross' })).toEqual(['https://rpc.example-test.test']);
  });

  it('has no endpoints at all when rewards are not configured', () => {
    const { ATLAS_DAILY_REWARDS_ENABLED: _off, ...rest } = mainnetRewards;
    expect(parseAtlasRewardRpcUrls(rest)).toEqual([]);
  });

  it('refuses endpoints that are not https', () => {
    // A payout verified over plaintext is a payout an intermediary can rewrite.
    const insecure = { ...mainnetRewards, ATLAS_MAINNET_RPC_URLS: 'http://rpc.plain.test,https://rpc.ok.test' };
    expect(parseAtlasRewardRpcUrls(insecure)).toEqual(['https://rpc.ok.test']);
  });

  it('accepts several endpoints so one outage is not a stall', () => {
    const many = { ...mainnetRewards, ATLAS_MAINNET_RPC_URLS: ' https://a.test , https://b.test ' };
    expect(parseAtlasRewardRpcUrls(many)).toEqual(['https://a.test', 'https://b.test']);
  });

  it('asks mainnet for more confirmations than a practice chain by default', () => {
    // A reorg on mainnet costs real money; on testnet it costs nothing.
    const { ATLAS_MAINNET_MIN_CONFIRMATIONS: _none, ...noOverride } = { ...mainnetRewards, ATLAS_MAINNET_MIN_CONFIRMATIONS: '' };
    expect(parseAtlasRewardMinConfirmations(noOverride)).toBe(10);
    expect(parseAtlasRewardMinConfirmations({ ...mainnetRewards, ATLAS_REWARD_NETWORK: 'testalbatross' })).toBe(3);
  });

  it('honours an explicit confirmation count, and ignores a nonsensical one', () => {
    expect(parseAtlasRewardMinConfirmations({ ...mainnetRewards, ATLAS_MAINNET_MIN_CONFIRMATIONS: '25' })).toBe(25);
    expect(parseAtlasRewardMinConfirmations({ ...mainnetRewards, ATLAS_MAINNET_MIN_CONFIRMATIONS: '0' })).toBe(10);
    expect(parseAtlasRewardMinConfirmations({ ...mainnetRewards, ATLAS_MAINNET_MIN_CONFIRMATIONS: 'lots' })).toBe(10);
  });
});
