import type { AtlasApiClient } from './api';
import type { AtlasWalletAdapter } from './wallet';
import type { ApiResult } from '../net/api';
import type { AtlasNetwork } from '../../shared/atlas/types';
import { canonicalAtlasWalletBindingMessage, type AtlasWalletBinding } from '../../shared/atlas/wallet-binding';

export interface AtlasWalletBindingFlow {
  bind(input: { actorId: string; seasonId: string; network: AtlasNetwork }): Promise<ApiResult<AtlasWalletBinding>>;
}

/**
 * Keeps the explicit wallet action in one seam: request an account, obtain a
 * server challenge, sign its readable message, then bind the public key.
 * This flow never calls sendBasicPayment or broadcasts a transaction.
 */
export function createAtlasWalletBindingFlow(options: {
  api: Pick<AtlasApiClient, 'issueWalletChallenge' | 'bindWallet'>;
  wallet: Pick<AtlasWalletAdapter, 'requestAccounts' | 'signWalletMessage'>;
}): AtlasWalletBindingFlow {
  return {
    async bind(input) {
      try {
        const accounts = await options.wallet.requestAccounts();
        const address = accounts[0];
        if (!address) return { ok: false, error: 'Nimiq Pay returned no usable account.' };

        const challenge = await options.api.issueWalletChallenge({ ...input, address });
        if (!challenge.ok) return challenge;

        const signature = await options.wallet.signWalletMessage(canonicalAtlasWalletBindingMessage(challenge.value));
        return options.api.bindWallet({
          actorId: input.actorId,
          challenge: challenge.value,
          publicKey: signature.publicKey,
          signature: signature.signature,
        });
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Wallet identity binding could not be completed.' };
      }
    },
  };
}
