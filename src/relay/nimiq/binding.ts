import type { NimiqProvider } from '@nimiq/mini-app-sdk';

import { canonicalRelayBindingMessage } from '../../../shared/relay/wallet-binding';
import { getProvider, isProviderError, isTestnet } from '../../nimiq/wallet';

export interface RelayWalletChallenge {
  id: string;
  domain: string;
  actorId: string;
  address: string;
  network: 'main' | 'test';
  nonce: string;
  issuedAt: number;
  expiresAt: number;
  purpose: 'relay-wallet-binding';
}

export interface RelayWalletBindingRequest {
  challenge: RelayWalletChallenge;
  address: string;
  publicKey: string;
  signature: string;
}

export class RelayWalletClientError extends Error {
  readonly code: 'wallet_unavailable' | 'wallet_not_approved' | 'wallet_rejected' | 'wallet_invalid_reply';

  constructor(code: RelayWalletClientError['code'], message: string) {
    super(message);
    this.name = 'RelayWalletClientError';
    this.code = code;
  }
}

export async function getRelayWalletAccount(providerOverride?: NimiqProvider): Promise<{ provider: NimiqProvider; address: string; network: 'main' | 'test' }> {
  const provider = providerOverride ?? await getProvider();
  if (!provider) throw new RelayWalletClientError('wallet_unavailable', 'Open this action inside Nimiq Pay to bind a wallet.');
  let accounts: string[] | { error: { type: string; message: string } };
  try { accounts = await provider.listAccounts(); } catch { throw new RelayWalletClientError('wallet_not_approved', 'Wallet account access was not approved.'); }
  if (isProviderError(accounts)) throw new RelayWalletClientError('wallet_not_approved', accounts.error.message || 'Wallet account access was not approved.');
  const address = accounts[0];
  if (!address) throw new RelayWalletClientError('wallet_not_approved', 'Approve one wallet account before submitting a verified run.');
  return { provider, address, network: isTestnet(provider.getNetwork()) ? 'test' : 'main' };
}

export async function requestRelayWalletBinding(challenge: RelayWalletChallenge, providerOverride?: NimiqProvider): Promise<RelayWalletBindingRequest> {
  const account = await getRelayWalletAccount(providerOverride);
  const provider = account.provider;

  let result: Awaited<ReturnType<NimiqProvider['sign']>>;
  try { result = await provider.sign(canonicalRelayBindingMessage(challenge)); } catch { throw new RelayWalletClientError('wallet_rejected', 'The wallet did not sign the binding request.'); }
  if (isProviderError(result)) throw new RelayWalletClientError('wallet_rejected', result.error.message || 'The wallet did not sign the binding request.');
  if (typeof result.publicKey !== 'string' || typeof result.signature !== 'string' || !result.publicKey || !result.signature) {
    throw new RelayWalletClientError('wallet_invalid_reply', 'The wallet returned an invalid signature reply.');
  }
  return { challenge, address: account.address, publicKey: result.publicKey, signature: result.signature };
}
