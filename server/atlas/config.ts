export interface AtlasProductionGate {
  competitive: boolean;
  rewards: boolean;
  durableRepository: boolean;
}

export interface AtlasCompetitivePolicy {
  network: 'testalbatross';
  seasonId: string;
  challengeId: string;
  seed: string;
  campaignHash: string;
  curriculumHash: string;
  rulesetHash: string;
}

export function parseAtlasCompetitivePolicy(env: Readonly<Record<string, string | undefined>> = process.env): AtlasCompetitivePolicy | null {
  const policy = {
    network: 'testalbatross' as const,
    seasonId: env.ATLAS_COMPETITIVE_SEASON_ID ?? '',
    challengeId: env.ATLAS_COMPETITIVE_CHALLENGE_ID ?? '',
    seed: env.ATLAS_COMPETITIVE_SEED ?? '',
    campaignHash: env.ATLAS_COMPETITIVE_CAMPAIGN_HASH ?? '',
    curriculumHash: env.ATLAS_COMPETITIVE_CURRICULUM_HASH ?? '',
    rulesetHash: env.ATLAS_COMPETITIVE_RULESET_HASH ?? '',
  };
  if (!/^[a-z0-9-]{1,80}$/.test(policy.seasonId) || !/^[a-z0-9-]{1,80}$/.test(policy.challengeId) || !/^[a-zA-Z0-9:_-]{1,128}$/.test(policy.seed)) return null;
  if ([policy.campaignHash, policy.curriculumHash, policy.rulesetHash].some((value) => !/^[a-f0-9]{64}$/.test(value))) return null;
  return policy;
}

export function parseAtlasProductionGate(env: Readonly<Record<string, string | undefined>> = process.env): AtlasProductionGate {
  const durableRepository = env.ATLAS_DURABLE_REPOSITORY_ENABLED === 'true';
  const competitive = durableRepository && env.ATLAS_COMPETITIVE_ENABLED === 'true' && parseAtlasCompetitivePolicy(env) !== null;
  const rewards = competitive && env.ATLAS_REWARDS_ENABLED === 'true';
  return Object.freeze({ competitive, rewards, durableRepository });
}

export interface AtlasTreasuryConfig {
  enabled: boolean;
  reason: 'rewards-disabled' | 'missing-treasury' | 'invalid-treasury' | null;
  treasuryAddress: string | null;
}

/**
 * Gate for the reward treasury.
 *
 * `rewards` already implies `competitive`, which already implies
 * `durableRepository`, so an enabled treasury always has somewhere durable to
 * keep its ledger. That chain is the point: `server/atlas/payouts.ts` refuses
 * a duplicate payout id, and that refusal is the only thing standing between a
 * redeploy and paying the same reward twice, but it only holds if the ledger
 * survives the restart.
 */
export function parseAtlasTreasuryConfig(env: Readonly<Record<string, string | undefined>> = process.env): AtlasTreasuryConfig {
  const gate = parseAtlasProductionGate(env);
  const treasuryAddress = (env.ATLAS_TREASURY_ADDRESS ?? '').replace(/\s/g, '').toUpperCase();
  if (!gate.rewards) return { enabled: false, reason: 'rewards-disabled', treasuryAddress: treasuryAddress || null };
  if (!treasuryAddress) return { enabled: false, reason: 'missing-treasury', treasuryAddress: null };
  if (!/^NQ\d{2}[0-9A-HJ-NP-VXY]{32}$/.test(treasuryAddress)) return { enabled: false, reason: 'invalid-treasury', treasuryAddress };
  return { enabled: true, reason: null, treasuryAddress };
}

export interface AtlasDailyRewardConfig {
  enabled: boolean;
  reason: 'disabled' | 'no-durable-store' | 'missing-treasury' | 'invalid-treasury' | 'missing-pool' | 'invalid-pool' | 'unknown-reward-network' | 'missing-reward-network' | 'missing-mainnet-genesis' | null;
  /** The chain the pot is funded on. Never inherited from the purchase side. */
  network: 'testalbatross' | 'mainalbatross' | null;
  treasuryAddress: string | null;
  poolLuna: number | null;
}

/*
 * The daily run's pot, gated on its own terms.
 *
 * Deliberately NOT behind `parseAtlasProductionGate().rewards`, which requires
 * the whole competitive block: ATLAS_COMPETITIVE_ENABLED plus five hashes
 * pinning a campaign, a curriculum and a ruleset. Those exist to make a
 * competitive season reproducible. A daily reward is a different product and
 * should not be unlockable only by declaring a season that is not running.
 *
 * It does require a durable store, and that one is not negotiable: eligibility
 * has to survive a restart or a wallet that already qualified today can
 * qualify again, and the day's close pays it twice out of real funds.
 */
export function parseAtlasDailyRewardConfig(env: Readonly<Record<string, string | undefined>> = process.env): AtlasDailyRewardConfig {
  /*
   * A reward treasury must name the network it is funded on.
   *
   * Daily rewards are paid in real mainnet NIM while purchases settle on
   * testnet, so the two halves run on different chains and the payout side can
   * no longer inherit the purchase network. A mainnet treasury sitting in a
   * testnet payout path is how real funds get settled against a practice
   * chain; this refuses rather than letting a gate elsewhere be the only thing
   * standing in the way.
   *
   * Mainnet additionally requires its genesis hash, which is what proves the
   * configured RPC is on the chain it claims. Without it, mainnet is refused.
   */
  const requestedNetwork = (env.ATLAS_REWARD_NETWORK ?? '').trim().toLowerCase();
  if (requestedNetwork && requestedNetwork !== 'testalbatross' && requestedNetwork !== 'mainalbatross') {
    return { enabled: false, reason: 'unknown-reward-network', treasuryAddress: null, poolLuna: null, network: null };
  }
  const treasuryAddress = (env.ATLAS_TREASURY_ADDRESS ?? '').replace(/\s/g, '').toUpperCase() || null;
  const empty = { treasuryAddress, poolLuna: null, network: null };
  if (env.ATLAS_DAILY_REWARDS_ENABLED !== 'true') return { enabled: false, reason: 'disabled', ...empty };
  if (env.ATLAS_DURABLE_REPOSITORY_ENABLED !== 'true') return { enabled: false, reason: 'no-durable-store', ...empty };
  if (!treasuryAddress) return { enabled: false, reason: 'missing-treasury', ...empty };
  if (!/^NQ\d{2}[0-9A-HJ-NP-VXY]{32}$/.test(treasuryAddress)) return { enabled: false, reason: 'invalid-treasury', ...empty };
  const raw = (env.ATLAS_DAILY_POOL_LUNA ?? '').trim();
  if (!/^\d+$/.test(raw)) return { enabled: false, reason: 'missing-pool', ...empty };
  const poolLuna = Number(raw);
  if (!Number.isSafeInteger(poolLuna) || poolLuna <= 0) return { enabled: false, reason: 'invalid-pool', ...empty };
  // Stated explicitly, never defaulted: a pot that does not say which chain it
  // is funded on is the ambiguity this whole function exists to remove.
  const rewardNetwork: 'testalbatross' | 'mainalbatross' | null =
    requestedNetwork === 'mainalbatross' ? 'mainalbatross' : requestedNetwork === 'testalbatross' ? 'testalbatross' : null;
  if (!rewardNetwork) return { enabled: false, reason: 'missing-reward-network', ...empty };
  if (rewardNetwork === 'mainalbatross' && !(env.ATLAS_MAINNET_GENESIS_HASH ?? '').trim()) {
    return { enabled: false, reason: 'missing-mainnet-genesis', ...empty };
  }
  return { enabled: true, reason: null, treasuryAddress, poolLuna, network: rewardNetwork };
}

/*
 * RPC endpoints for the reward chain, read from that network's own prefix.
 *
 * Never merged with the purchase network's list: an endpoint borrowed from
 * ATLAS_TESTNET_RPC_URLS would settle a real payout against a practice chain,
 * which is the failure the prefixes exist to prevent.
 */
export function parseAtlasRewardRpcUrls(env: Readonly<Record<string, string | undefined>> = process.env): readonly string[] {
  const network = parseAtlasDailyRewardConfig(env).network;
  if (!network) return [];
  const raw = env[network === 'mainalbatross' ? 'ATLAS_MAINNET_RPC_URLS' : 'ATLAS_TESTNET_RPC_URLS'] ?? '';
  return raw.split(',').map((url) => url.trim()).filter((url) => url.startsWith('https://'));
}

/** Confirmations a payout must reach on the reward chain before it counts. */
export function parseAtlasRewardMinConfirmations(env: Readonly<Record<string, string | undefined>> = process.env): number {
  const network = parseAtlasDailyRewardConfig(env).network;
  const raw = (env[network === 'mainalbatross' ? 'ATLAS_MAINNET_MIN_CONFIRMATIONS' : 'ATLAS_TESTNET_MIN_CONFIRMATIONS'] ?? '').trim();
  const value = Number(raw);
  // Mainnet defaults higher than testnet: a reorg there costs real money.
  return /^\d+$/.test(raw) && Number.isSafeInteger(value) && value > 0 ? value : network === 'mainalbatross' ? 10 : 3;
}

export const ATLAS_PRODUCTION_GATE = parseAtlasProductionGate();
export const ATLAS_TREASURY_CONFIG = parseAtlasTreasuryConfig();
export const ATLAS_COMPETITIVE_POLICY = parseAtlasCompetitivePolicy();
export const ATLAS_DAILY_REWARD_CONFIG = parseAtlasDailyRewardConfig();
export const ATLAS_DAILY_POOL_LUNA = ATLAS_DAILY_REWARD_CONFIG.poolLuna;
export const ATLAS_REWARD_MIN_CONFIRMATIONS = parseAtlasRewardMinConfirmations();

import { createAtlasPaymentConfig, type AtlasPaymentNetwork } from '../../shared/atlas/payment-config';
import { ATLAS_LANTERN_PRICE_LUNA } from '../../shared/atlas/economy';

export interface AtlasPaymentServerConfig {
  enabled: boolean;
  reason:
    | 'disabled'
    | 'missing-recipient'
    | 'fixture-recipient'
    | 'invalid-recipient'
    | 'invalid-amount'
    | 'missing-genesis-hash'
    | 'missing-rpc'
    | 'unknown-network'
    | null;
  network: AtlasPaymentNetwork;
  recipient: string | null;
  valueLuna: number;
  itemId: 'harbor-lantern';
  minConfirmations: number;
  rpcUrls: string[];
  /** Passed to createAtlasChainReader so it can prove the RPC's chain. */
  genesisHash: string | null;
}

/*
 * Each network reads its own variables. They are never merged and neither
 * falls back to the other, because a mainnet deployment that silently borrowed
 * ATLAS_TESTNET_RECIPIENT would send real NIM to a practice address, and one
 * that borrowed ATLAS_TESTNET_RPC_URLS would settle real payments against
 * practice evidence.
 */
const NETWORK_ENV_PREFIX: Readonly<Record<AtlasPaymentNetwork, string>> = Object.freeze({
  testalbatross: 'ATLAS_TESTNET',
  mainalbatross: 'ATLAS_MAINNET',
});

export function parseAtlasPaymentConfig(env: Readonly<Record<string, string | undefined>> = process.env): AtlasPaymentServerConfig {
  const requested = (env.ATLAS_NETWORK ?? 'testalbatross').trim().toLowerCase();
  if (requested !== 'testalbatross' && requested !== 'mainalbatross') {
    // Refuse rather than fall back. Guessing a network is how real money ends
    // up settled against the wrong chain.
    return {
      enabled: false,
      reason: 'unknown-network',
      network: 'testalbatross',
      recipient: null,
      valueLuna: 0,
      itemId: 'harbor-lantern',
      minConfirmations: 3,
      rpcUrls: [],
      genesisHash: null,
    };
  }
  const network: AtlasPaymentNetwork = requested;
  const prefix = NETWORK_ENV_PREFIX[network];
  const payment = createAtlasPaymentConfig({
    network,
    enabled: env[`${prefix}_ENABLED`] === 'true',
    recipient: env[`${prefix}_RECIPIENT`],
    valueLuna: env[`${prefix}_PRICE_LUNA`] ?? String(ATLAS_LANTERN_PRICE_LUNA),
    genesisHash: env[`${prefix}_GENESIS_HASH`],
  });
  const rpcUrls = (env[`${prefix}_RPC_URLS`] ?? '').split(',').map((value) => value.trim()).filter((value) => /^https:\/\//.test(value));
  const parsedConfirmations = Number(env[`${prefix}_MIN_CONFIRMATIONS`] ?? '3');
  const minConfirmations = Number.isSafeInteger(parsedConfirmations) && parsedConfirmations >= 1 && parsedConfirmations <= 100 ? parsedConfirmations : 3;
  if (!payment.enabled) return { ...payment, minConfirmations, rpcUrls };
  if (rpcUrls.length === 0) return { ...payment, enabled: false, reason: 'missing-rpc', minConfirmations, rpcUrls };
  return { ...payment, minConfirmations, rpcUrls };
}
