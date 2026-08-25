import { z, type ZodType } from 'zod';

import { isIsoUtcDate } from '../../shared/relay/types';

export const RELAY_REQUEST_MAX_BYTES = 16 * 1024;

export const relayDateSchema = z.string().refine(isIsoUtcDate, 'Date must be a valid UTC date.');
export const relayActorSchema = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/, 'Actor id is invalid.');
export const relayTicketSchema = z.string().regex(/^[0-9a-f]{32}$/, 'Ticket id is invalid.');
export const relayNetworkSchema = z.enum(['main', 'test']);
export const relayAddressSchema = z.string().trim().min(3).max(64);
export const relayNonceSchema = z.string().regex(/^[0-9a-f-]{16,128}$/i, 'Nonce is invalid.');
export const relayPublicKeySchema = z.string().regex(/^[0-9a-f]{64,128}$/i, 'Public key is invalid.');
export const relaySignatureSchema = z.string().regex(/^[0-9a-f]{128,256}$/i, 'Signature is invalid.');

export const relayWalletChallengeSchema = z.object({
  actorId: relayActorSchema,
  address: relayAddressSchema,
  network: relayNetworkSchema,
});

export const relayWalletBindingProofSchema = z.object({
  challenge: z.object({
    id: z.string().min(1).max(128),
    domain: z.string().regex(/^[A-Za-z0-9.-]{1,128}$/),
    actorId: relayActorSchema,
    address: relayAddressSchema,
    network: relayNetworkSchema,
    nonce: relayNonceSchema,
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative(),
    purpose: z.literal('relay-wallet-binding'),
  }),
  publicKey: relayPublicKeySchema,
  signature: relaySignatureSchema,
});

export const relayAttemptSchema = z.object({
  actorId: relayActorSchema,
  missionDate: relayDateSchema,
  network: relayNetworkSchema.default('test'),
});

export const relayRunSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/),
  actorId: relayActorSchema,
  ticketId: relayTicketSchema,
  walletAddress: relayAddressSchema,
  missionDate: relayDateSchema,
  network: relayNetworkSchema,
  ruleset: z.literal('relay-1'),
  seedCommitment: z.string().regex(/^[0-9a-f]{64}$/),
  traceHash: z.string().regex(/^[0-9a-f]{64}$/),
  trace: z.record(z.string(), z.unknown()),
  result: z.record(z.string(), z.unknown()),
});

export type RelayRequestError = 'relay_body_too_large' | 'relay_invalid_body';
export type RelayBodyResult<T> = { ok: true; value: T } | { ok: false; error: RelayRequestError };

export function parseRelayBody<T>(schema: ZodType<T>, body: unknown, byteLength?: number): RelayBodyResult<T> {
  if (byteLength !== undefined && byteLength > RELAY_REQUEST_MAX_BYTES) return { ok: false, error: 'relay_body_too_large' };
  const result = schema.safeParse(body);
  return result.success ? { ok: true, value: result.data } : { ok: false, error: 'relay_invalid_body' };
}
