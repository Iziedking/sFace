import { describe, expect, it } from 'vitest';
import { parseAtlasDailyRewardConfig } from '../server/atlas/config';

const MAINNET_TREASURY = 'NQ22EY1GT6FH5X60JGQQ6MK7H973T31PMYV4';

const funded = {
  ATLAS_DAILY_REWARDS_ENABLED: 'true',
  ATLAS_DURABLE_REPOSITORY_ENABLED: 'true',
  ATLAS_TREASURY_ADDRESS: MAINNET_TREASURY,
  ATLAS_DAILY_POOL_LUNA: '10000',
};

describe('the daily reward treasury', () => {
  /*
   * Purchases settle on testnet and daily rewards are paid in real mainnet
   * NIM, so the two halves run on different chains. The payout side used to
   * inherit whichever network purchases used, which meant a mainnet treasury
   * could sit inside a testnet payout path with nothing but an unrelated
   * feature gate standing between it and a real payout against a practice
   * chain. The pot has to name its own chain.
   */
  it('refuses a treasury that does not say which chain it is funded on', () => {
    expect(parseAtlasDailyRewardConfig(funded)).toMatchObject({ enabled: false, reason: 'missing-reward-network' });
  });

  it('refuses mainnet until its genesis hash proves the chain', () => {
    const mainnet = { ...funded, ATLAS_REWARD_NETWORK: 'mainalbatross' };
    expect(parseAtlasDailyRewardConfig(mainnet)).toMatchObject({ enabled: false, reason: 'missing-mainnet-genesis' });
    expect(parseAtlasDailyRewardConfig({ ...mainnet, ATLAS_MAINNET_GENESIS_HASH: ' ' })).toMatchObject({ reason: 'missing-mainnet-genesis' });
    expect(parseAtlasDailyRewardConfig({ ...mainnet, ATLAS_MAINNET_GENESIS_HASH: 'abc123' })).toMatchObject({ enabled: true, network: 'mainalbatross' });
  });

  it('does not demand a genesis hash from a practice chain', () => {
    expect(parseAtlasDailyRewardConfig({ ...funded, ATLAS_REWARD_NETWORK: 'testalbatross' })).toMatchObject({ enabled: true, network: 'testalbatross' });
  });

  it('refuses a network it does not recognise rather than falling back', () => {
    // Guessing a network is how real money settles against the wrong chain.
    expect(parseAtlasDailyRewardConfig({ ...funded, ATLAS_REWARD_NETWORK: 'mainnet' })).toMatchObject({ enabled: false, reason: 'unknown-reward-network' });
  });

  it('insists on a durable store, because eligibility that forgets pays twice', () => {
    const volatile = { ...funded, ATLAS_REWARD_NETWORK: 'testalbatross', ATLAS_DURABLE_REPOSITORY_ENABLED: 'false' };
    expect(parseAtlasDailyRewardConfig(volatile)).toMatchObject({ enabled: false, reason: 'no-durable-store' });
  });

  it('refuses a malformed or absent treasury address', () => {
    const network = { ATLAS_REWARD_NETWORK: 'testalbatross' };
    expect(parseAtlasDailyRewardConfig({ ...funded, ...network, ATLAS_TREASURY_ADDRESS: '' })).toMatchObject({ reason: 'missing-treasury' });
    expect(parseAtlasDailyRewardConfig({ ...funded, ...network, ATLAS_TREASURY_ADDRESS: 'NOT-AN-ADDRESS' })).toMatchObject({ reason: 'invalid-treasury' });
  });

  it('refuses a pot that is absent, zero or not an integer', () => {
    const network = { ATLAS_REWARD_NETWORK: 'testalbatross' };
    expect(parseAtlasDailyRewardConfig({ ...funded, ...network, ATLAS_DAILY_POOL_LUNA: '' })).toMatchObject({ reason: 'missing-pool' });
    expect(parseAtlasDailyRewardConfig({ ...funded, ...network, ATLAS_DAILY_POOL_LUNA: '0' })).toMatchObject({ reason: 'invalid-pool' });
    expect(parseAtlasDailyRewardConfig({ ...funded, ...network, ATLAS_DAILY_POOL_LUNA: '0.5' })).toMatchObject({ reason: 'missing-pool' });
  });

  it('is off entirely until it is deliberately switched on', () => {
    const { ATLAS_DAILY_REWARDS_ENABLED: _omitted, ...rest } = funded;
    expect(parseAtlasDailyRewardConfig({ ...rest, ATLAS_REWARD_NETWORK: 'testalbatross' })).toMatchObject({ enabled: false, reason: 'disabled' });
  });
});
