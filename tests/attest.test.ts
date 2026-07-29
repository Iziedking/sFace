/**
 * The attestation path, which is the first thing in this codebase that makes a
 * cryptographic claim. Every test here is an attempt to break it.
 */

import { describe, expect, it } from 'vitest';
import { KeyPair } from '@nimiq/core';

import { claimMessage, encodeSignedMessage, verifyClaim } from '../server/attest';

const CLAIM = { date: '2026-07-29', seed: '2026-07-29:pump:-6.70:fng29:x1', stage: 3, score: 14820 };

function signed(claim = CLAIM, keyPair = KeyPair.generate()) {
  const message = encodeSignedMessage(claimMessage(claim));
  const signature = keyPair.sign(message);
  return {
    keyPair,
    publicKey: keyPair.publicKey.toHex(),
    signature: signature.toHex(),
    address: keyPair.publicKey.toAddress().toUserFriendlyAddress(),
  };
}

describe('a genuine claim stands', () => {
  it('verifies and derives the signer', () => {
    const s = signed();
    const result = verifyClaim({ claim: CLAIM, publicKey: s.publicKey, signature: s.signature });

    expect(result).not.toBeNull();
    expect(result!.address).toBe(s.address);
    expect(result!.address).toMatch(/^NQ/);
  });

  it('derives the address rather than trusting one it was handed', () => {
    // The caller never supplies an address, so there is no field to lie in.
    const s = signed();
    const result = verifyClaim({ claim: CLAIM, publicKey: s.publicKey, signature: s.signature });
    expect(result!.address).toBe(s.keyPair.publicKey.toAddress().toUserFriendlyAddress());
  });
});

describe('every field is inside the signature', () => {
  it.each([
    ['score', { ...CLAIM, score: CLAIM.score + 1 }],
    ['stage', { ...CLAIM, stage: 7 }],
    ['seed', { ...CLAIM, seed: 'some-other-seed' }],
    ['date', { ...CLAIM, date: '2026-07-30' }],
  ])('rejects a swapped %s', (_what, tampered) => {
    const s = signed(CLAIM);
    expect(
      verifyClaim({ claim: tampered, publicKey: s.publicKey, signature: s.signature }),
    ).toBeNull();
  });
});

describe('forgery fails', () => {
  it('rejects another wallet claiming this signature', () => {
    const mine = signed();
    const theirs = KeyPair.generate();

    expect(
      verifyClaim({
        claim: CLAIM,
        publicKey: theirs.publicKey.toHex(),
        signature: mine.signature,
      }),
    ).toBeNull();
  });

  it('rejects garbage without throwing', () => {
    const s = signed();
    for (const bad of ['', 'zz', 'deadbeef', 'not-hex-at-all', s.signature.slice(0, -2)]) {
      expect(verifyClaim({ claim: CLAIM, publicKey: s.publicKey, signature: bad })).toBeNull();
      expect(verifyClaim({ claim: CLAIM, publicKey: bad, signature: s.signature })).toBeNull();
    }
  });
});

describe('the wallet prefix is mandatory', () => {
  it('refuses a signature made over the bare message', () => {
    // Signing the raw bytes is what a naive implementation would do, and it
    // must not verify: the prefix is the thing that stops a signed "message"
    // from ever being replayable as a transaction.
    const keyPair = KeyPair.generate();
    const raw = new TextEncoder().encode(claimMessage(CLAIM));
    const signature = keyPair.sign(raw);

    expect(
      verifyClaim({
        claim: CLAIM,
        publicKey: keyPair.publicKey.toHex(),
        signature: signature.toHex(),
      }),
    ).toBeNull();
  });

  it('encodes the byte length, not the character length', () => {
    // A multi-byte character would desynchronise the prefix from the body and
    // every signature over it would silently fail to verify.
    const message = 'sface:é';
    const encoded = encodeSignedMessage(message);
    const body = new TextEncoder().encode(message);
    expect(new TextDecoder().decode(encoded)).toContain(`\x16Nimiq Signed Message:\n${body.byteLength}`);
  });
});
