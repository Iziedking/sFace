/**
 * Connect X, so a player's own profile picture rides on their character.
 *
 * OAuth 2.0 with PKCE. The client starts the flow, X redirects back here with
 * a code, we exchange it, read the account, and hand back a handle, a name and
 * an avatar URL. Then we forget everything.
 *
 * ## What is stored
 *
 * Nothing. There is no user table, no session, and no refresh token kept. The
 * access token is used once, in the same request that exchanges the code, and
 * then dropped. What the client gets back is three public strings that appear
 * on the player's own screen. If this service were fully compromised tomorrow,
 * there would be no X account it could act on behalf of.
 *
 * That is a deliberate trade. Keeping a refresh token would let us re-read a
 * changed avatar later, and it would also make this a service that holds
 * credentials for other people's social accounts, which is not something a
 * ninety second game needs to be.
 *
 * ## Why the exchange happens here and not in the browser
 *
 * X requires the client secret for confidential clients, and a secret in a
 * Vite bundle is not a secret. The verifier stays with the browser, the secret
 * stays here, and neither side can complete the flow alone.
 */

import { randomBytes, createHash } from 'node:crypto';

/**
 * x.com, not twitter.com. Both resolve, but twitter.com answers with a
 * cross-host redirect, and this URL is loaded into a popup that then has to
 * postMessage back to an origin we check. Starting on the canonical host keeps
 * that chain to one hop and removes a class of popup-blocker and referrer
 * surprises that only ever show up on someone else's phone.
 */
const AUTHORIZE_URL = 'https://x.com/i/oauth2/authorize';
const TOKEN_URL = 'https://api.x.com/2/oauth2/token';
const ME_URL = 'https://api.x.com/2/users/me?user.fields=profile_image_url,name,username';

const CLIENT_ID = process.env.X_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.X_CLIENT_SECRET ?? '';
const REDIRECT_URI = process.env.X_REDIRECT_URI ?? '';

/** A started flow is only allowed to sit around this long. */
const FLOW_TTL_MS = 10 * 60_000;
const MAX_PENDING = 500;

export interface XProfile {
  handle: string;
  displayName: string;
  /** Upgraded from the default thumbnail to something worth rendering. */
  avatarUrl: string | null;
}

export type Result<T> = { ok: true; value: T } | { ok: false; reason: string; code: number };

interface Pending {
  verifier: string;
  createdAt: number;
}

/** state -> verifier. In memory, short lived, single process. */
const pending = new Map<string, Pending>();

export function xauthConfigured(): boolean {
  return Boolean(CLIENT_ID && CLIENT_SECRET && REDIRECT_URI);
}

/**
 * Begin a flow. Returns the URL to send the browser to.
 *
 * PKCE with S256. The verifier never leaves this process and the challenge is
 * the only thing that travels, so intercepting the redirect gains nothing.
 */
export function begin(): Result<{ url: string; state: string }> {
  if (!xauthConfigured()) {
    return { ok: false, reason: 'X connect is not configured.', code: 503 };
  }

  sweep();
  if (pending.size >= MAX_PENDING) {
    return { ok: false, reason: 'Too many sign-ins in flight. Try again shortly.', code: 429 };
  }

  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  const state = base64url(randomBytes(16));

  pending.set(state, { verifier, createdAt: Date.now() });

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  // The narrowest scopes that still return a handle and an avatar. No write,
  // no follows, no direct messages, no offline access.
  url.searchParams.set('scope', 'users.read tweet.read');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');

  return { ok: true, value: { url: url.toString(), state } };
}

/** Finish a flow. The state is single use, whether or not it succeeds. */
export async function complete(state: string, code: string): Promise<Result<XProfile>> {
  if (!xauthConfigured()) {
    return { ok: false, reason: 'X connect is not configured.', code: 503 };
  }

  const flow = pending.get(state);
  // Consumed immediately. A replayed callback must not get a second attempt.
  pending.delete(state);

  if (!flow) {
    return { ok: false, reason: 'That sign-in expired. Try again.', code: 400 };
  }
  if (Date.now() - flow.createdAt > FLOW_TTL_MS) {
    return { ok: false, reason: 'That sign-in expired. Try again.', code: 400 };
  }

  try {
    const token = await exchange(code, flow.verifier);
    if (!token) return { ok: false, reason: 'X refused the sign-in.', code: 502 };

    const profile = await readMe(token);
    if (!profile) return { ok: false, reason: 'Could not read that account.', code: 502 };

    return { ok: true, value: profile };
  } catch (error) {
    console.error('[sface] xauth failed', error instanceof Error ? error.message : error);
    return { ok: false, reason: 'Could not reach X.', code: 502 };
  }
}

async function exchange(code: string, verifier: string): Promise<string | null> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  });

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      // Confidential client. This is why the exchange is here and not in the
      // browser: a bundled secret is not a secret.
      authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
    },
    body,
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    console.error(`[sface] xauth token exchange returned ${response.status}`);
    return null;
  }

  const json = (await response.json()) as { access_token?: unknown };
  return typeof json.access_token === 'string' ? json.access_token : null;
}

async function readMe(token: string): Promise<XProfile | null> {
  const response = await fetch(ME_URL, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) return null;

  const json = (await response.json()) as {
    data?: { username?: unknown; name?: unknown; profile_image_url?: unknown };
  };
  const data = json.data;
  if (!data) return null;

  const handle = typeof data.username === 'string' ? data.username.toLowerCase() : '';
  if (!/^[a-z0-9_]{1,15}$/.test(handle)) return null;

  return {
    handle,
    displayName: typeof data.name === 'string' ? data.name.slice(0, 40) : `@${handle}`,
    avatarUrl: upgradeAvatar(data.profile_image_url),
  };
}

/**
 * X hands back a 48 pixel thumbnail by default, which is mush on a character's
 * head at two device pixels per unit. The size is encoded in the filename, so
 * swapping the suffix asks for the larger original.
 */
function upgradeAvatar(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    if (url.hostname !== 'pbs.twimg.com' && url.hostname !== 'abs.twimg.com') return null;

    url.pathname = url.pathname.replace(/_(normal|bigger|mini)\.(jpg|jpeg|png|gif|webp)$/i, '_400x400.$2');
    return url.toString();
  } catch {
    return null;
  }
}

function base64url(buffer: Buffer): string {
  return buffer.toString('base64url');
}

function sweep(): void {
  const cutoff = Date.now() - FLOW_TTL_MS;
  for (const [state, flow] of pending) {
    if (flow.createdAt < cutoff) pending.delete(state);
  }
}

export { FLOW_TTL_MS };
