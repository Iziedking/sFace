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

const STORAGE_KEY = 'sface.pilot';
const SOURCE_KEY = 'sface.pilot.source';

export type IdentitySource = 'local' | 'nimiq';

let cached: string | null = null;
let source: IdentitySource = 'local';

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
  if (source === 'nimiq' && cached === deviceId) return false;

  cached = deviceId;
  source = 'nimiq';
  write(STORAGE_KEY, deviceId);
  write(SOURCE_KEY, 'nimiq');
  return true;
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
