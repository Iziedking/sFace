import { beforeEach, describe, expect, it } from 'vitest';

import { PlayerAuth } from '../server/player-auth';
import {
  encodeChallenge,
  mergeBodyDigest,
  type MergeClaim,
  type PublicKeyJwk,
} from '../src/net/player-auth-protocol';

async function keyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign', 'verify'],
  );
}

async function publicJwk(pair: CryptoKeyPair): Promise<PublicKeyJwk> {
  return (await crypto.subtle.exportKey('jwk', pair.publicKey)) as PublicKeyJwk;
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

describe('player authentication authority', () => {
  let auth: PlayerAuth;
  let pair: CryptoKeyPair;
  let jwk: PublicKeyJwk;

  beforeEach(async () => {
    auth = new PlayerAuth();
    pair = await keyPair();
    jwk = await publicJwk(pair);
  });

  it('registers the same public key as the same player', async () => {
    const first = await auth.register({ publicKeyJwk: jwk, now: 10 });
    const second = await auth.register({ publicKeyJwk: { ...jwk }, now: 20 });
    expect(first.ok).toBe(true);
    expect(second).toEqual(first);
  });

  it('refuses a malformed public key', async () => {
    expect(
      await auth.register({ publicKeyJwk: { kty: 'oct', crv: '', x: '', y: '' } }),
    ).toEqual({
      ok: false,
      error: 'invalid_credential',
    });
  });

  it('verifies once and refuses a replay', async () => {
    const registered = await auth.register({ publicKeyJwk: jwk, now: 100 });
    if (!registered.ok) throw new Error('registration failed');
    const claim: MergeClaim = { from: 'a'.repeat(64), into: registered.value.playerId, network: 'main' };
    const bodyDigest = await mergeBodyDigest(claim);
    const issued = auth.issueChallenge({
      playerId: registered.value.playerId,
      action: 'profile.merge',
      bodyDigest,
      now: 200,
    });
    if (!issued.ok) throw new Error('challenge failed');
    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      pair.privateKey,
      Uint8Array.from(encodeChallenge(issued.value)).buffer,
    );
    const proof = { challengeId: issued.value.id, publicKeyJwk: jwk, signature: hex(signature) };

    expect((await auth.verify({ proof, action: 'profile.merge', bodyDigest, now: 201 })).ok).toBe(true);
    expect(await auth.verify({ proof, action: 'profile.merge', bodyDigest, now: 202 })).toEqual({
      ok: false,
      error: 'unknown_challenge',
    });
  });

  it('refuses expired and body-swapped challenges', async () => {
    const registered = await auth.register({ publicKeyJwk: jwk, now: 100 });
    if (!registered.ok) throw new Error('registration failed');
    const issued = auth.issueChallenge({
      playerId: registered.value.playerId,
      action: 'profile.merge',
      bodyDigest: 'a'.repeat(64),
      now: 200,
    });
    if (!issued.ok) throw new Error('challenge failed');
    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      pair.privateKey,
      Uint8Array.from(encodeChallenge(issued.value)).buffer,
    );
    const proof = { challengeId: issued.value.id, publicKeyJwk: jwk, signature: hex(signature) };

    expect(await auth.verify({ proof, action: 'profile.merge', bodyDigest: 'b'.repeat(64), now: 201 })).toEqual({
      ok: false,
      error: 'body_mismatch',
    });

    const later = auth.issueChallenge({
      playerId: registered.value.playerId,
      action: 'profile.merge',
      bodyDigest: 'a'.repeat(64),
      now: 300,
    });
    if (!later.ok) throw new Error('challenge failed');
    expect(
      await auth.verify({
        proof: { ...proof, challengeId: later.value.id },
        action: 'profile.merge',
        bodyDigest: 'a'.repeat(64),
        now: later.value.expiresAt + 1,
      }),
    ).toEqual({ ok: false, error: 'expired_challenge' });
  });

  it('restores credentials without restoring used challenges', async () => {
    const registered = await auth.register({ publicKeyJwk: jwk, now: 100 });
    if (!registered.ok) throw new Error('registration failed');
    const restored = new PlayerAuth();
    restored.restore(auth.serialise());

    const issued = restored.issueChallenge({
      playerId: registered.value.playerId,
      action: 'profile.merge',
      bodyDigest: 'a'.repeat(64),
      now: 200,
    });
    expect(issued.ok).toBe(true);
  });

  it('binds a chat edit proof to the exact edited body', async () => {
    const registered = await auth.register({ publicKeyJwk: jwk, now: 100 });
    if (!registered.ok) throw new Error('registration failed');
    const digest = await mergeBodyDigest({
      from: registered.value.playerId,
      into: 'b'.repeat(64),
      network: 'main',
    });
    const issued = auth.issueChallenge({
      playerId: registered.value.playerId,
      action: 'chat.edit',
      bodyDigest: digest,
      now: 200,
    });
    if (!issued.ok) throw new Error('challenge failed');
    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      pair.privateKey,
      Uint8Array.from(encodeChallenge(issued.value)).buffer,
    );
    const proof = { challengeId: issued.value.id, publicKeyJwk: jwk, signature: hex(signature) };
    expect(
      await auth.verify({
        proof,
        action: 'chat.edit',
        bodyDigest: 'f'.repeat(64),
        now: 201,
      }),
    ).toEqual({ ok: false, error: 'body_mismatch' });
  });
});
