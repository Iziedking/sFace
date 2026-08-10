export type AuthAction = 'player.register' | 'profile.merge';

export interface MergeClaim {
  from: string;
  into: string;
  network: string;
}

export interface Challenge {
  id: string;
  action: AuthAction;
  playerId: string;
  bodyDigest: string;
  nonce: string;
  expiresAt: number;
}

export interface PublicKeyJwk {
  kty: string;
  crv: string;
  x: string;
  y: string;
  d?: string;
  key_ops?: string[];
  ext?: boolean;
}

export interface DeviceProof {
  challengeId: string;
  publicKeyJwk: PublicKeyJwk;
  signature: string;
}

const encoder = new TextEncoder();

function requireText(name: string, value: string): string {
  if (value.length === 0) throw new Error(`${name} must not be empty.`);
  return value;
}

function encodeFields(fields: ReadonlyArray<readonly [string, string]>): Uint8Array {
  const parts = fields.map(([name, value]) => {
    const label = encoder.encode(requireText('field name', name));
    const body = encoder.encode(requireText(name, value));
    const header = new Uint8Array(8);
    const view = new DataView(header.buffer);
    view.setUint32(0, label.byteLength);
    view.setUint32(4, body.byteLength);
    return { label, body, header };
  });
  const length = parts.reduce(
    (total, part) => total + part.header.byteLength + part.label.byteLength + part.body.byteLength,
    0,
  );
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part.header, offset);
    offset += part.header.byteLength;
    out.set(part.label, offset);
    offset += part.label.byteLength;
    out.set(part.body, offset);
    offset += part.body.byteLength;
  }
  return out;
}

export function encodeMergeClaim(claim: MergeClaim): Uint8Array {
  return encodeFields([
    ['protocol', 'sface.player-auth.v1'],
    ['action', 'profile.merge'],
    ['from', claim.from],
    ['into', claim.into],
    ['network', claim.network],
  ]);
}

export function encodeChallenge(challenge: Challenge): Uint8Array {
  if (!Number.isFinite(challenge.expiresAt)) throw new Error('expiresAt must be finite.');
  return encodeFields([
    ['protocol', 'sface.player-auth.v1'],
    ['id', challenge.id],
    ['action', challenge.action],
    ['playerId', challenge.playerId],
    ['bodyDigest', challenge.bodyDigest],
    ['nonce', challenge.nonce],
    ['expiresAt', String(challenge.expiresAt)],
  ]);
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function mergeBodyDigest(claim: MergeClaim): Promise<string> {
  return sha256Hex(encodeMergeClaim(claim));
}

export function publicKeyId(jwk: PublicKeyJwk): Promise<string> {
  return sha256Hex(
    encoder.encode(`kty:${jwk.kty}\ncrv:${jwk.crv}\nx:${jwk.x}\ny:${jwk.y}`),
  );
}
