import type { AtlasNetwork } from './types';

export interface AtlasWalletBindingChallenge {
  id: string;
  domain: string;
  purpose: 'atlas-wallet-binding';
  actorId: string;
  seasonId: string;
  address: string;
  network: AtlasNetwork;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}

export interface AtlasWalletBinding {
  actorId: string;
  seasonId: string;
  address: string;
  network: AtlasNetwork;
  publicKey: string;
  boundAt: number;
}

/**
 * The wallet signs this exact line order. Keeping it in shared code prevents
 * the browser and server from drifting while the signed message remains
 * readable in a wallet prompt.
 */
export function canonicalAtlasWalletBindingMessage(challenge: AtlasWalletBindingChallenge): string {
  return [challenge.domain, challenge.purpose, challenge.actorId, challenge.seasonId, challenge.address, challenge.network, challenge.nonce, String(challenge.issuedAt), String(challenge.expiresAt)].join('\n');
}
