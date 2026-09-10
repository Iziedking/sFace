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

export const ATLAS_PRODUCTION_GATE = parseAtlasProductionGate();
export const ATLAS_COMPETITIVE_POLICY = parseAtlasCompetitivePolicy();

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
