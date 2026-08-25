import { z } from 'zod';

const booleanFlag = z.enum(['true', 'false']).default('false');

export interface RelayConfig {
  enabled: boolean;
  competitiveEnabled: boolean;
  rewardsEnabled: boolean;
  practiceEnabled: true;
  rewardsDisabledReason: 'missing_reward_configuration' | 'rewards_disabled_by_flag' | null;
  seasonId: string;
  treasuryAddress: string | null;
  minConfirmations: number;
  network: 'main' | 'test';
  rpcUrls: string[];
  seasonAllocationLuna?: number;
}

export function parseRelayConfig(env: Readonly<Record<string, string | undefined>> = process.env): RelayConfig {
  const parsed = z.object({
    RELAY_ENABLED: booleanFlag,
    RELAY_COMPETITIVE_ENABLED: booleanFlag,
    RELAY_REWARDS_ENABLED: booleanFlag,
    RELAY_SEASON_ID: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/).default('season-0'),
    RELAY_TREASURY_ADDRESS: z.string().trim().max(128).default(''),
    RELAY_MIN_CONFIRMATIONS: z.coerce.number().int().min(1).max(100).default(10),
    RELAY_NIMIQ_NETWORK: z.enum(['main', 'test']).default('test'),
    NIMIQ_RPC_URLS: z.string().default(''),
    RELAY_SEASON_ALLOCATION_LUNA: z.coerce.number().int().safe().positive().default(8_000_000_000),
  }).parse(env);
  const rpcUrls = parsed.NIMIQ_RPC_URLS.split(',').map((value) => value.trim()).filter((value) => /^https:\/\//.test(value));
  const requestedRewards = parsed.RELAY_REWARDS_ENABLED === 'true';
  const rewardsEnabled = requestedRewards && parsed.RELAY_TREASURY_ADDRESS.length > 0 && rpcUrls.length > 0;
  return {
    enabled: parsed.RELAY_ENABLED === 'true',
    competitiveEnabled: parsed.RELAY_COMPETITIVE_ENABLED === 'true',
    rewardsEnabled,
    practiceEnabled: true,
    rewardsDisabledReason: rewardsEnabled ? null : requestedRewards ? 'missing_reward_configuration' : 'rewards_disabled_by_flag',
    seasonId: parsed.RELAY_SEASON_ID,
    treasuryAddress: parsed.RELAY_TREASURY_ADDRESS || null,
    minConfirmations: parsed.RELAY_MIN_CONFIRMATIONS,
    network: parsed.RELAY_NIMIQ_NETWORK,
    rpcUrls,
    seasonAllocationLuna: parsed.RELAY_SEASON_ALLOCATION_LUNA,
  };
}
