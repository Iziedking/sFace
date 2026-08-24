import { isIsoUtcDate, type RelayRulesetVersion } from './types';

export interface RelaySeedCommitmentInput {
  ruleset: RelayRulesetVersion | string;
  missionDate: string;
  seedHex: string;
}

function appendLengthPrefixed(target: number[], value: Uint8Array): void {
  const length = value.byteLength;
  target.push((length >>> 24) & 0xff, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff);
  for (const byte of value) target.push(byte);
}

export function encodeRelayCommitmentInput(input: RelaySeedCommitmentInput): Uint8Array {
  if (typeof input.ruleset !== 'string' || input.ruleset.length === 0) throw new Error('Ruleset is required.');
  if (!/^[0-9a-f]+$/.test(input.seedHex) || input.seedHex.length % 2 !== 0) {
    throw new Error('Seed must be lowercase hexadecimal bytes.');
  }
  const encoder = new TextEncoder();
  const bytes: number[] = [];
  appendLengthPrefixed(bytes, encoder.encode(input.ruleset));
  appendLengthPrefixed(bytes, encoder.encode(input.missionDate));
  appendLengthPrefixed(bytes, encoder.encode(input.seedHex));
  return Uint8Array.from(bytes);
}

export async function commitRelaySeed(input: RelaySeedCommitmentInput): Promise<string> {
  if (!isIsoUtcDate(input.missionDate)) throw new Error('Mission date must be an ISO UTC date.');
  const encoded = encodeRelayCommitmentInput(input);
  const buffer = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(buffer).set(encoded);
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    buffer,
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
