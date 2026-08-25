import { PrivateKey, PublicKey, Signature } from '@nimiq/core';
import { describe, expect, it } from 'vitest';

import { encodeSignedMessage } from '../server/attest';
import { canonicalRelayBindingBytes, canonicalRelayBindingMessage } from '../shared/relay/wallet-binding';
import { verifyRelayWalletSignature, type RelayWalletBindingChallenge } from '../server/relay/wallet-bindings';

const challenge: RelayWalletBindingChallenge = {
  id: 'challenge-1',
  domain: 'sface.site',
  actorId: 'actor-1',
  address: 'NQ00 0000 0000 0000 0000 0000 0000 0000 0000',
  network: 'test',
  nonce: 'nonce-1',
  issuedAt: 1_724_492_800_000,
  expiresAt: 1_724_493_100_000,
  purpose: 'relay-wallet-binding',
};

describe('Relay wallet binding', () => {
  it('keeps the canonical message and UTF-8 bytes stable', () => {
    const message = canonicalRelayBindingMessage(challenge);
    expect(message).toBe('sface.site\nrelay-wallet-binding\nactor-1\nNQ00 0000 0000 0000 0000 0000 0000 0000 0000\ntest\nnonce-1\n1724492800000\n1724493100000');
    expect(Buffer.from(canonicalRelayBindingBytes(challenge)).toString('hex')).toBe('73666163652e736974650a72656c61792d77616c6c65742d62696e64696e670a6163746f722d310a4e513030203030303020303030302030303030203030303020303030302030303030203030303020303030300a746573740a6e6f6e63652d310a313732343439323830303030300a31373234343933313030303030');
  });

  it('verifies only the exact actor, address, network, purpose, nonce, expiry, public key, and signature', () => {
    const privateKey = PrivateKey.generate();
    const publicKey = PublicKey.derive(privateKey);
    const address = publicKey.toAddress().toUserFriendlyAddress();
    const bound = { ...challenge, address };
    const signature = Signature.create(privateKey, publicKey, encodeSignedMessage(canonicalRelayBindingMessage(bound))).toHex();
    const proof = { challenge: bound, publicKey: publicKey.toHex(), signature };

    const validNow = bound.issuedAt + 1;
    expect(verifyRelayWalletSignature(proof, validNow)).toEqual({ address });
    for (const field of ['actorId', 'address', 'network', 'nonce', 'issuedAt', 'expiresAt', 'purpose'] as const) {
      const altered = { ...bound, [field]: field === 'issuedAt' || field === 'expiresAt' ? bound[field] + 1 : `${bound[field]}-altered` };
      expect(verifyRelayWalletSignature({ challenge: altered, publicKey: publicKey.toHex(), signature }, validNow)).toBeNull();
    }
    expect(verifyRelayWalletSignature({ challenge: bound, publicKey: PublicKey.derive(PrivateKey.generate()).toHex(), signature }, validNow)).toBeNull();
    const alteredSignature = `${signature.slice(0, -2)}${signature.endsWith('00') ? '01' : '00'}`;
    expect(verifyRelayWalletSignature({ challenge: bound, publicKey: publicKey.toHex(), signature: alteredSignature }, validNow)).toBeNull();
    expect(verifyRelayWalletSignature({ challenge: bound, publicKey: publicKey.toHex(), signature }, bound.expiresAt + 1)).toBeNull();
  });
});
