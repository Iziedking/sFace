export const ATLAS_PRODUCTION_GATE = Object.freeze({
  competitive: false,
  rewards: false,
  durableRepository: false,
} as const);

import { createAtlasTestnetPaymentConfig } from '../../shared/atlas/payment-config';

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
    valueLuna: env.ATLAS_TESTNET_PRICE_LUNA ?? '100000',
  });
  const rpcUrls = (env.ATLAS_TESTNET_RPC_URLS ?? '').split(',').map((value) => value.trim()).filter((value) => /^https:\/\//.test(value));
  const parsedConfirmations = Number(env.ATLAS_TESTNET_MIN_CONFIRMATIONS ?? '3');
  const minConfirmations = Number.isSafeInteger(parsedConfirmations) && parsedConfirmations >= 1 && parsedConfirmations <= 100 ? parsedConfirmations : 3;
  if (!payment.enabled) return { ...payment, minConfirmations, rpcUrls };
  if (rpcUrls.length === 0) return { ...payment, enabled: false, reason: 'missing-rpc', minConfirmations, rpcUrls };
  return { ...payment, minConfirmations, rpcUrls };
}
