/**
 * Challenge settlement. The loser pays the winner directly, peer to peer.
 *
 * The app never holds funds. There is no pot and no escrow, which keeps this
 * out of custody territory entirely. We request, Nimiq Pay shows a native
 * dialog, the user approves, the chain settles. The app coordinates and the
 * chain is the receipt.
 *
 * Verified against @nimiq/mini-app-sdk@0.1.0. Three things about this API bite
 * anyone working from memory, so they are spelled out:
 *
 *   1. The method is sendBasicTransactionWithData, not sendTransaction. The
 *      memo rides in `data`.
 *   2. `value` is in Lunas. 1 NIM = 1e5 Lunas. Sending a NIM figure straight
 *      through underpays by five orders of magnitude.
 *   3. Failures resolve as { error: { type, message } } instead of throwing,
 *      and success resolves as the serialized transaction hex, not an object
 *      with a hash. Never read result.hash and never trust a bare try/catch.
 */

import { getProvider, isProviderError, nimToLunas } from './wallet';

/**
 * Ceiling on a single settlement. A challenge is a bet between two players,
 * not a wire transfer, and a stake this size can only ever be a mistake or a
 * malformed deeplink. Refuse it before it reaches the confirmation dialog.
 */
export const MAX_STAKE_NIM = 1000;

/** Memos are written into the transaction, so they stay short and printable. */
const MAX_MEMO_BYTES = 64;

export interface SettlementRequest {
  /** Winner's Nimiq address. */
  recipient: string;
  /** Stake in NIM, agreed when the challenge was created. */
  amountNim: number;
  /** Shown to the user in the confirmation dialog and written on chain. */
  memo: string;
}

export type SettlementResult =
  | { ok: true; serializedTx: string }
  | { ok: false; reason: string };

/**
 * Ask the host to send the stake. Returns a plain result rather than throwing,
 * because the caller is a UI screen and every failure here has a sentence the
 * player needs to read.
 */
export async function settle(
  request: SettlementRequest,
): Promise<SettlementResult> {
  const invalid = validate(request);
  if (invalid) return { ok: false, reason: invalid };

  const nimiq = await getProvider();
  if (!nimiq) {
    return { ok: false, reason: 'Open this in Nimiq Pay to settle the stake.' };
  }

  try {
    // Do not ask a user to approve money against a wallet that is still
    // catching up. The dialog would appear and the send would fail behind it.
    const consensus = await nimiq.isConsensusEstablished();
    if (!consensus) {
      return { ok: false, reason: 'Wallet is still syncing. Try again shortly.' };
    }

    const result = await nimiq.sendBasicTransactionWithData({
      recipient: request.recipient,
      value: nimToLunas(request.amountNim),
      data: request.memo,
    });

    // The error envelope resolves rather than rejecting. This branch is the
    // whole reason this function does not just wrap the call in a try/catch.
    if (isProviderError(result)) {
      return { ok: false, reason: readableError(result.error.message) };
    }

    if (typeof result !== 'string' || result.length === 0) {
      return { ok: false, reason: 'The payment did not complete.' };
    }

    return { ok: true, serializedTx: result };
  } catch (error) {
    return { ok: false, reason: readableError(String(error)) };
  }
}

/** Reject anything malformed before it reaches a confirmation dialog. */
function validate(request: SettlementRequest): string | null {
  if (!isNimiqAddress(request.recipient)) {
    return 'That challenge link has a bad address.';
  }
  if (!Number.isFinite(request.amountNim) || request.amountNim <= 0) {
    return 'That stake is not a real amount.';
  }
  if (request.amountNim > MAX_STAKE_NIM) {
    return `Stakes are capped at ${MAX_STAKE_NIM} NIM.`;
  }
  if (byteLength(request.memo) > MAX_MEMO_BYTES) {
    return 'That memo is too long to write on chain.';
  }
  return null;
}

/**
 * Nimiq addresses are 36 characters of base32 in the form
 * NQ07 0000 0000 0000 0000 0000 0000 0000 0000, spaces optional. This catches
 * a truncated or tampered deeplink, not a wrong-but-well-formed address.
 */
export function isNimiqAddress(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const compact = value.replace(/\s/g, '').toUpperCase();
  return /^NQ\d{2}[0-9A-HJ-NP-VXY]{32}$/.test(compact);
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Turn provider noise into one sentence a player can act on. */
function readableError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes('reject') || lower.includes('denied') || lower.includes('cancel')) {
    return 'Payment declined.';
  }
  if (lower.includes('balance') || lower.includes('funds')) {
    return 'Not enough NIM to cover that stake.';
  }
  return 'The payment could not be sent.';
}
