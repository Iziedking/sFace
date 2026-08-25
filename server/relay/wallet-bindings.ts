import { randomUUID } from 'node:crypto';
import { Address, PublicKey, Signature } from '@nimiq/core';

import { encodeSignedMessage } from '../attest';
import { canonicalRelayBindingMessage } from '../../shared/relay/wallet-binding';
import type { RelayStore, RelaySnapshot } from './store';

const BINDING_TTL_MS = 5 * 60 * 1_000;
const PURPOSE = 'relay-wallet-binding';
const DOMAIN = 'sface.site';

export interface RelayWalletBindingChallenge {
  id: string;
  domain: string;
  actorId: string;
  address: string;
  network: 'main' | 'test';
  nonce: string;
  issuedAt: number;
  expiresAt: number;
  purpose: typeof PURPOSE;
}

export interface RelayWalletBinding {
  actorId: string;
  address: string;
  network: 'main' | 'test';
  publicKey: string;
  boundAt: number;
}

export interface RelayWalletBindingProof {
  challenge: RelayWalletBindingChallenge;
  publicKey: string;
  signature: string;
}

export class RelayWalletBindingError extends Error {
  readonly code: 'relay_wallet_binding_invalid' | 'relay_wallet_binding_expired' | 'relay_wallet_binding_conflict';

  constructor(code: RelayWalletBindingError['code'], message: string) {
    super(message);
    this.name = 'RelayWalletBindingError';
    this.code = code;
  }
}

export function verifyRelayWalletSignature(input: RelayWalletBindingProof, now = Date.now()): { address: string } | null {
  try {
    const challenge = input.challenge;
    if (challenge.domain !== DOMAIN || challenge.purpose !== PURPOSE || challenge.network !== 'main' && challenge.network !== 'test') return null;
    if (!Number.isSafeInteger(challenge.issuedAt) || !Number.isSafeInteger(challenge.expiresAt) || now >= challenge.expiresAt || challenge.expiresAt <= challenge.issuedAt) return null;
    const address = Address.fromUserFriendlyAddress(challenge.address).toUserFriendlyAddress();
    const publicKey = PublicKey.fromHex(input.publicKey);
    const signature = Signature.fromHex(input.signature);
    if (publicKey.toAddress().toUserFriendlyAddress() !== address) return null;
    if (!publicKey.verify(signature, encodeSignedMessage(canonicalRelayBindingMessage({ ...challenge, address })))) return null;
    return { address };
  } catch {
    return null;
  }
}

export interface RelayWalletBindingService {
  issueChallenge(input: { actorId: string; address: string; network: 'main' | 'test'; now?: number }): RelayWalletBindingChallenge;
  bind(input: RelayWalletBindingProof, now?: number): Promise<RelayWalletBinding>;
  isBound(actorId: string, network: 'main' | 'test'): Promise<boolean>;
  getBinding(actorId: string, network: 'main' | 'test'): Promise<RelayWalletBinding | null>;
}

export function createRelayWalletBindingService(options: { store: RelayStore; now?: () => number; domain?: string }): RelayWalletBindingService {
  const now = options.now ?? (() => Date.now());
  const challenges = new Map<string, RelayWalletBindingChallenge>();
  let snapshot: RelaySnapshot | null = null;
  const ensure = async (): Promise<RelaySnapshot> => { if (!snapshot) snapshot = await options.store.load(); return snapshot; };
  return {
    issueChallenge(input) {
      const issuedAt = input.now ?? now();
      const challenge: RelayWalletBindingChallenge = { id: randomUUID(), domain: options.domain ?? DOMAIN, actorId: input.actorId, address: Address.fromUserFriendlyAddress(input.address).toUserFriendlyAddress(), network: input.network, nonce: randomUUID().replaceAll('-', ''), issuedAt, expiresAt: issuedAt + BINDING_TTL_MS, purpose: PURPOSE };
      challenges.set(challenge.id, challenge);
      return challenge;
    },
    async bind(input, current = now()) {
      const held = challenges.get(input.challenge.id);
      if (!held || held.id !== input.challenge.id) throw new RelayWalletBindingError('relay_wallet_binding_invalid', 'Wallet binding challenge is unknown.');
      challenges.delete(input.challenge.id);
      if (current >= held.expiresAt) throw new RelayWalletBindingError('relay_wallet_binding_expired', 'Wallet binding challenge has expired.');
      const verified = verifyRelayWalletSignature({ ...input, challenge: held }, current);
      if (!verified) throw new RelayWalletBindingError('relay_wallet_binding_invalid', 'Wallet signature does not match the binding challenge.');
      const currentSnapshot = await ensure();
      const key = `${held.actorId}:${held.network}`;
      const existing = currentSnapshot.walletBindings[key] as unknown as RelayWalletBinding | undefined;
      if (existing && (existing.address !== verified.address || existing.publicKey !== input.publicKey)) throw new RelayWalletBindingError('relay_wallet_binding_conflict', 'Actor is already bound to another wallet key.');
      if (Object.values(currentSnapshot.walletBindings).some((binding) => (binding as unknown as RelayWalletBinding).address === verified.address && (binding as unknown as RelayWalletBinding).actorId !== held.actorId)) throw new RelayWalletBindingError('relay_wallet_binding_conflict', 'Wallet is already bound to another actor.');
      const binding: RelayWalletBinding = { actorId: held.actorId, address: verified.address, network: held.network, publicKey: input.publicKey, boundAt: current };
      const next = structuredClone(currentSnapshot);
      next.walletBindings[key] = binding as unknown as Record<string, unknown>;
      await options.store.commit('wallet-binding.created', next);
      snapshot = next;
      return binding;
    },
    async isBound(actorId, network) {
      const currentSnapshot = await ensure();
      const binding = currentSnapshot.walletBindings[`${actorId}:${network}`] as unknown as RelayWalletBinding | undefined;
      return Boolean(binding);
    },
    async getBinding(actorId, network) {
      const currentSnapshot = await ensure();
      const binding = currentSnapshot.walletBindings[`${actorId}:${network}`] as unknown as RelayWalletBinding | undefined;
      return binding ? structuredClone(binding) : null;
    },
  };
}
