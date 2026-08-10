import {
  encodeChallenge,
  type AuthAction,
  type Challenge,
  type DeviceProof,
  type PublicKeyJwk,
  publicKeyId,
} from '../src/net/player-auth-protocol';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export interface PlayerCredential {
  playerId: string;
  publicKeyJwk: PublicKeyJwk;
  createdAt: number;
  lastSeenAt: number;
  legacy: boolean;
}

export interface PlayerAuthSnapshot {
  version: 1;
  credentials: PlayerCredential[];
}

type AuthError =
  | 'invalid_credential'
  | 'unknown_player'
  | 'unknown_challenge'
  | 'expired_challenge'
  | 'wrong_action'
  | 'body_mismatch'
  | 'unauthorized';

type Result<T> = { ok: true; value: T } | { ok: false; error: AuthError };

interface HeldChallenge {
  challenge: Challenge;
  playerId: string;
}

function validPublicJwk(value: PublicKeyJwk): value is PublicKeyJwk & {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
} {
  return (
    value.kty === 'EC' &&
    value.crv === 'P-256' &&
    typeof value.x === 'string' &&
    value.x.length > 0 &&
    typeof value.y === 'string' &&
    value.y.length > 0 &&
    value.d === undefined
  );
}

function canonicalJwk(value: PublicKeyJwk): PublicKeyJwk {
  return {
    kty: 'EC',
    crv: 'P-256',
    x: value.x,
    y: value.y,
    key_ops: ['verify'],
    ext: true,
  };
}

async function playerIdFor(jwk: PublicKeyJwk): Promise<string> {
  return publicKeyId(canonicalJwk(jwk));
}

function randomHex(bytes: number): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function fromHex(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) return null;
  const out = new Uint8Array(new ArrayBuffer(value.length / 2));
  for (let index = 0; index < value.length; index += 2) {
    out[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return out;
}

export class PlayerAuth {
  private readonly credentials = new Map<string, PlayerCredential>();
  private readonly challenges = new Map<string, HeldChallenge>();

  hasCredential(playerId: string): boolean {
    return this.credentials.has(playerId);
  }

  async register(input: {
    publicKeyJwk: PublicKeyJwk;
    now?: number;
  }): Promise<Result<{ playerId: string }>> {
    if (!validPublicJwk(input.publicKeyJwk)) return { ok: false, error: 'invalid_credential' };
    try {
      await crypto.subtle.importKey(
        'jwk',
        canonicalJwk(input.publicKeyJwk),
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['verify'],
      );
    } catch {
      return { ok: false, error: 'invalid_credential' };
    }
    const now = input.now ?? Date.now();
    const playerId = await playerIdFor(input.publicKeyJwk);
    const existing = this.credentials.get(playerId);
    this.credentials.set(playerId, {
      playerId,
      publicKeyJwk: canonicalJwk(input.publicKeyJwk),
      createdAt: existing?.createdAt ?? now,
      lastSeenAt: now,
      legacy: false,
    });
    return { ok: true, value: { playerId } };
  }

  issueChallenge(input: {
    playerId: string;
    action: AuthAction;
    bodyDigest: string;
    now?: number;
  }): Result<Challenge> {
    const now = input.now ?? Date.now();
    this.prune(now);
    if (!this.credentials.has(input.playerId)) return { ok: false, error: 'unknown_player' };
    const challenge: Challenge = {
      id: randomHex(16),
      action: input.action,
      playerId: input.playerId,
      bodyDigest: input.bodyDigest,
      nonce: randomHex(32),
      expiresAt: now + CHALLENGE_TTL_MS,
    };
    this.challenges.set(challenge.id, { challenge, playerId: input.playerId });
    return { ok: true, value: challenge };
  }

  async verify(input: {
    proof: DeviceProof;
    action: AuthAction;
    bodyDigest: string;
    now?: number;
  }): Promise<Result<{ playerId: string }>> {
    const now = input.now ?? Date.now();
    const held = this.challenges.get(input.proof.challengeId);
    if (!held) return { ok: false, error: 'unknown_challenge' };
    this.challenges.delete(input.proof.challengeId);
    if (held.challenge.expiresAt < now) return { ok: false, error: 'expired_challenge' };
    if (held.challenge.action !== input.action) return { ok: false, error: 'wrong_action' };
    if (held.challenge.bodyDigest !== input.bodyDigest) return { ok: false, error: 'body_mismatch' };
    if (!validPublicJwk(input.proof.publicKeyJwk)) return { ok: false, error: 'unauthorized' };
    if ((await playerIdFor(input.proof.publicKeyJwk)) !== held.playerId) {
      return { ok: false, error: 'unauthorized' };
    }
    const signature = fromHex(input.proof.signature);
    if (!signature) return { ok: false, error: 'unauthorized' };
    try {
      const key = await crypto.subtle.importKey(
        'jwk',
        canonicalJwk(input.proof.publicKeyJwk),
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['verify'],
      );
      const valid = await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        key,
        signature,
        Uint8Array.from(encodeChallenge(held.challenge)).buffer,
      );
      if (!valid) return { ok: false, error: 'unauthorized' };
    } catch {
      return { ok: false, error: 'unauthorized' };
    }
    const credential = this.credentials.get(held.playerId);
    if (credential) credential.lastSeenAt = now;
    return { ok: true, value: { playerId: held.playerId } };
  }

  serialise(): PlayerAuthSnapshot {
    return { version: 1, credentials: [...this.credentials.values()] };
  }

  restore(raw: unknown): void {
    this.credentials.clear();
    if (!raw || typeof raw !== 'object') return;
    const snapshot = raw as Partial<PlayerAuthSnapshot>;
    if (snapshot.version !== 1 || !Array.isArray(snapshot.credentials)) return;
    for (const credential of snapshot.credentials) {
      if (
        credential &&
        typeof credential.playerId === 'string' &&
        validPublicJwk(credential.publicKeyJwk)
      ) {
        this.credentials.set(credential.playerId, {
          ...credential,
          publicKeyJwk: canonicalJwk(credential.publicKeyJwk),
        });
      }
    }
  }

  private prune(now: number): void {
    for (const [id, held] of this.challenges) {
      if (held.challenge.expiresAt < now) this.challenges.delete(id);
    }
  }
}
