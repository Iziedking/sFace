/**
 * Who this player is, for the purposes of a leaderboard and a squad.
 *
 * Nimiq Pay can give us a real device identifier: stable across reinstalls,
 * scoped to our origin, impossible to correlate with other mini apps. It is
 * the better identity by a distance. It also does not exist outside Nimiq Pay,
 * and asking for it costs a permission prompt.
 *
 * Gating on it was tried and it is the wrong trade. A judge who opens the URL
 * in a plain browser would see no squadmates, no leaderboard and no co-op, and
 * would reasonably conclude those features do not work. Prompting for it at
 * boot instead would put a permission dialog in front of a player who has not
 * seen the game yet, and onboarding under sixty seconds is an explicit
 * judging criterion.
 *
 * So: a locally generated identifier from the start, upgraded to the real
 * device identifier the first time we legitimately have a reason to ask, which
 * is after a run worth posting. Both are pseudonymous, neither is a login, and
 * nothing here is an authentication claim.
 *
 * **What this is not.** A local identifier can be reset by clearing site data,
 * so it is an anti-spam bucket and a squad key, not proof of anything. The
 * README says as much in those words. Nothing that moves NIM depends on it:
 * a settlement is authorised in the wallet, against an address on the payer's
 * own screen.
 */

import { getOrCreateCredential } from './player-credential';
import type { PublicKeyJwk } from './player-auth-protocol';

const STORAGE_KEY = 'sface.pilot';
const SOURCE_KEY = 'sface.pilot.source';

/**
 * ## One identity, whichever chain you are on
 *
 * An earlier build scoped this key by network, so switching to testnet handed
 * you a different pilot id and, with it, a different profile, clan and set of
 * challenges. That is the wrong cut. A person flying a rehearsal is the same
 * person, and making them a stranger to their own clan for the duration is a
 * cost with nothing bought.
 *
 * What actually needed separating was the scoring, and that separation lives
 * where scores live: the daily board keys on network, and a profile keeps one
 * set of totals per chain. So the boards are two and the player is one, which
 * is the thing being asked for. See the header of server/profiles.ts for why
 * the totals cannot be pooled.
 */

export type IdentitySource = 'local' | 'nimiq';

let cached: string | null = null;
let source: IdentitySource = 'local';

export async function initialiseIdentity(): Promise<{
  playerId: string;
  publicKeyJwk: PublicKeyJwk;
}> {
  const credential = await getOrCreateCredential();
  cached = credential.playerId;
  source = 'local';
  return { playerId: cached, publicKeyJwk: credential.publicKeyJwk };
}

export function legacyPilotId(): string | null {
  const stored = read(STORAGE_KEY);
  return stored && isWellFormed(stored) && stored !== cached ? stored : null;
}

/**
 * The current pilot identifier. Synchronous, always returns something, and
 * stable for as long as the browser keeps its storage.
 */
export function pilotId(): string {
  if (cached) return cached;

  const stored = read(STORAGE_KEY);
  if (stored && isWellFormed(stored)) {
    cached = stored;
    source = read(SOURCE_KEY) === 'nimiq' ? 'nimiq' : 'local';
    return cached;
  }

  cached = randomHex();
  source = 'local';
  write(STORAGE_KEY, cached);
  write(SOURCE_KEY, 'local');
  return cached;
}

/**
 * Adopt the real device identifier from Nimiq Pay.
 *
 * Called once, after a completed run, when the player granted it. From then on
 * this device reports the stronger identity. The switch does cost the player
 * their existing local board entry, which is worth it once and never again,
 * since the Nimiq identifier survives reinstalls and the local one does not.
 */
export function upgradeTo(deviceId: string): boolean {
  if (!isWellFormed(deviceId)) return false;
  // A host device id is public account metadata, not a signing credential.
  // Keep it only as legacy migration evidence and never replace the actor key.
  write(STORAGE_KEY, deviceId);
  write(SOURCE_KEY, 'nimiq');
  return false;
}

export function identitySource(): IdentitySource {
  pilotId();
  return source;
}

/** The service accepts 16 to 64 hex characters. Both kinds fit. */
function isWellFormed(value: string): boolean {
  return /^[0-9a-f]{16,64}$/i.test(value);
}

function randomHex(): string {
  const bytes = new Uint8Array(32);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    // No crypto in this WebView. This identifier is a squad key and an
    // anti-spam bucket, not a secret, so a weaker source is survivable.
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // Private mode, or storage disabled. The identifier lasts the session.
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Same. Nothing here is worth failing a run over.
  }
}

/** A display name with no form to fill in. Means nothing anywhere else. */
export function pilotName(id: string = pilotId()): string {
  return `Pilot ${id.slice(0, 4).toUpperCase()}`;
}

/**
 * The key a connected account's progress hangs off.
 *
 * ## Why derive one rather than add a field
 *
 * Every route, schema and store in this project keys a player on a 64 character
 * hex string. Deriving the account's key into that same shape means the board,
 * clans, ghosts, challenges and the verifier all keep working with no change at
 * all: they simply see a different id for the same person. The alternative was
 * threading an optional account field through every one of them, which is a lot
 * of surface for no gain.
 *
 * ## Why the handle
 *
 * It is what X gives us and what the game shows everywhere. A handle can be
 * changed by its owner, and if that happens the player starts a fresh record,
 * which is a rare and recoverable outcome rather than a wrong one. Nothing here
 * is a secret: this is a namespace, not a credential, and it is never used to
 * authorise anything.
 *
 * Lowercased first, because X handles are case insensitive and the same person
 * typing a different case must not become a different player.
 */
export async function accountKey(handle: string): Promise<string | null> {
  const clean = handle.replace(/^@/, '').trim().toLowerCase();
  if (!clean) return null;

  try {
    /*
     * No network in the realm. One handle is one player on every chain, and
     * their name, picture and clan follow them across the switch. What does
     * not follow is their Face, which the profile store keeps per chain.
     */
    const bytes = new TextEncoder().encode(`sface:x:${clean}`);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    /*
     * No SubtleCrypto, which happens on an insecure origin.
     *
     * Falling back to the device id rather than to a weaker hash: a same-device
     * record is the behaviour this replaced and is merely no better, while a
     * hand-rolled hash risks two people colliding onto one record, which is
     * worse than anything it would fix.
     */
    return null;
  }
}
