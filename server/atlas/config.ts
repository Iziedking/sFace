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

import { createAtlasTestnetPaymentConfig } from '../../shared/atlas/payment-config';
import { ATLAS_LANTERN_PRICE_LUNA } from '../../shared/atlas/economy';

export interface AtlasPaymentServerConfig {
  enabled: boolean;
  reason: 'disabled' | 'missing-recipient' | 'fixture-recipient' | 'invalid-recipient' | 'invalid-amount' | 'missing-rpc' | null;
  network: 'testalbatross';
  recipient: string | null;
  valueLuna: number;
  itemId: 'harbor-lantern';
  minConfirmations: number;
  rpcUrls: string[];
}

export function parseAtlasPaymentConfig(env: Readonly<Record<string, string | undefined>> = process.env): AtlasPaymentServerConfig {
  const payment = createAtlasTestnetPaymentConfig({
    enabled: env.ATLAS_TESTNET_ENABLED === 'true',
    recipient: env.ATLAS_TESTNET_RECIPIENT,
    valueLuna: env.ATLAS_TESTNET_PRICE_LUNA ?? String(ATLAS_LANTERN_PRICE_LUNA),
  });
  const rpcUrls = (env.ATLAS_TESTNET_RPC_URLS ?? '').split(',').map((value) => value.trim()).filter((value) => /^https:\/\//.test(value));
  const parsedConfirmations = Number(env.ATLAS_TESTNET_MIN_CONFIRMATIONS ?? '3');
  const minConfirmations = Number.isSafeInteger(parsedConfirmations) && parsedConfirmations >= 1 && parsedConfirmations <= 100 ? parsedConfirmations : 3;
  if (!payment.enabled) return { ...payment, minConfirmations, rpcUrls };
  if (rpcUrls.length === 0) return { ...payment, enabled: false, reason: 'missing-rpc', minConfirmations, rpcUrls };
  return { ...payment, minConfirmations, rpcUrls };
}
