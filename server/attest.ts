/**
 * Score attestation: turning "some device says 14,820" into "this Nimiq
 * address says 14,820, and nobody else could have said it for them".
 *
 * ## The hole this fills
 *
 * The README has admitted from the start that leaderboard scores are bounded
 * rather than proven: the service refuses impossible numbers and impossible
 * durations, keeps one entry per pilot per day, and that is a speed bump, not a
 * lock. The identity behind a row was a device id, which is a value the client
 * generates and can throw away and regenerate at will.
 *
 * A wallet signature fixes the identity half of that. The player signs a string
 * naming the exact day, seed, stage and score in Nimiq Pay, and the service
 * verifies the Ed25519 signature and derives the signer's address from the
 * public key. The row is then attributable to an address, the claim cannot be
 * forged by anyone who does not hold that key, and anybody can check it.
 *
 * ## What this does NOT prove, stated plainly
 *
 * It does not prove the run happened. A determined player can still sign a
 * score they did not earn, exactly as they could post one before. What changes
 * is that the claim is now non-repudiable and bound to an address with a public
 * history, so cheating stops being anonymous and starts being a thing a
 * specific wallet did in public, permanently. That is a different and much
 * better property than the device id ever had, and it is not the same thing as
 * proof of play. Do not describe it as anti-cheat.
 *
 * ## The prefix is not optional
 *
 * Nimiq wallets sign `\x16Nimiq Signed Message:\n<byteLength><message>` rather
 * than the bare message, which is what stops a signature obtained for a
 * "message" from ever being replayable as a transaction. Verified against the
 * library rather than assumed: signing the prefixed bytes verifies, signing the
 * raw bytes does not.
 */

import { Address, PublicKey, Signature } from '@nimiq/core';

const encoder = new TextEncoder();

/** Exactly what a Nimiq wallet signs when asked to sign a message. */
export function encodeSignedMessage(message: string): Uint8Array {
  const body = encoder.encode(message);
  const prefix = encoder.encode(`\x16Nimiq Signed Message:\n${body.byteLength}`);

  const out = new Uint8Array(prefix.byteLength + body.byteLength);
  out.set(prefix);
  out.set(body, prefix.byteLength);
  return out;
}

export interface ScoreClaim {
  date: string;
  seed: string;
  stage: number;
  score: number;
}

/**
 * The one string that gets signed.
 *
 * Every field that could be swapped for a better one is inside it. Signing only
 * the score would let a signature earned on stage one be presented as a stage
 * seven result, and signing only the date would let yesterday's good run be
 * replayed against today's seed.
 */
export function claimMessage(claim: ScoreClaim): string {
  return `sface:${claim.date}:${claim.seed}:s${claim.stage}:${claim.score}`;
}

export interface Attestation {
  /** Human-readable Nimiq address, derived from the key that signed. */
  address: string;
  claim: ScoreClaim;
}

/**
 * Verify a signed claim and return who signed it, or null.
 *
 * Returns null for every failure rather than throwing or distinguishing between
 * them. A caller has nothing useful to do with "the signature was malformed"
 * versus "the signature was wrong", and telling an attacker which of the two
 * they achieved is free information.
 */
export function verifyClaim(input: {
  claim: ScoreClaim;
  publicKey: string;
  signature: string;
}): Attestation | null {
  try {
    const message = encodeSignedMessage(claimMessage(input.claim));

    const publicKey = PublicKey.fromHex(input.publicKey);
    const signature = Signature.fromHex(input.signature);

    if (!publicKey.verify(signature, message)) return null;

    // Derived, never accepted from the client. An address supplied alongside a
    // signature is a claim about the signature; an address derived from the
    // public key IS the signature's author.
    const address: Address = publicKey.toAddress();

    return { address: address.toUserFriendlyAddress(), claim: input.claim };
  } catch {
    // Bad hex, wrong length, anything at all: the claim simply does not stand.
    return null;
  }
}
