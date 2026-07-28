/**
 * Real profile pictures for the people in today's wreck.
 *
 * ## This reverses an earlier decision, deliberately
 *
 * server/xsense.ts used to say, at length, that the roster would carry handles
 * and public context but never faces: naming a public figure and quoting what
 * they publicly said is ordinary, and putting their photograph on a game
 * character is a likeness question. That was a defensible call and it has been
 * overruled on purpose, because a wreck full of generated figures does not
 * read as the people it names, and the whole premise of the game is that these
 * are the actual accounts crypto was actually arguing about today.
 *
 * What that costs is worth stating plainly rather than glossing:
 *
 *   - The picture is a public profile image, fetched from X's own API, for an
 *     account X's own API says exists. Nothing is scraped and nothing is
 *     inferred.
 *   - It is displayed, never stored. There is no image copied to our disk and
 *     no cache beyond the URL, which expires when the account changes it.
 *   - The characters remain obviously drawn characters. A photograph rides on
 *     the head of an illustrated figure; nobody is depicted doing anything.
 *   - The roster is people being publicly discussed, and the line beside them
 *     is about what was publicly said. See the voice rules in data/story.ts:
 *     nothing claims anything about a real person's money or conduct.
 *
 * The README says all of the above too. If that paragraph and this one ever
 * disagree, this file is the one that ships and the README is the bug.
 *
 * ## Why app-only auth, and which credential
 *
 * Looking up a public profile needs no user context, so this authenticates as
 * the app rather than as anybody. It cannot read a timeline, cannot post, and
 * cannot act for a user even if the token leaked.
 *
 * X has two credential pairs on one app and they are not interchangeable,
 * which cost an hour to discover from a bare 403:
 *
 *   OAuth 2.0 Client ID + Client Secret  user context, PKCE. This is what
 *                                        Connect X in server/xauth.ts uses.
 *   API Key + API Secret                 the consumer pair, and the only thing
 *                                        `oauth2/token` accepts for the client
 *                                        credentials grant.
 *
 * The developer portal also hands out a ready-made Bearer Token, which is the
 * same thing the grant would have produced. So this prefers X_BEARER_TOKEN if
 * it is set, and mints one from X_API_KEY and X_API_SECRET if it is not.
 * Passing the OAuth 2.0 client id here returns 403 code 99, "Unable to verify
 * your credentials", which does not hint that the wrong pair was used.
 */

const TOKEN_URL = 'https://api.x.com/oauth2/token';
const USERS_URL = 'https://api.x.com/2/users/by';
const TIMEOUT_MS = 12_000;

/**
 * Hard ceiling on lookups per UTC day.
 *
 * The roster is composed once a day, so anything past a handful means
 * something is looping. Metered APIs and runaway loops are the expensive kind
 * of bug, which is the same reasoning as the ceiling in xsense.ts.
 */
const MAX_CALLS_PER_DAY = 6;

let callsToday = 0;
let callDay = '';
/** The app token, cached until it stops working. Not a user credential. */
let cachedToken: string | null = null;

export function xusersConfigured(): boolean {
  return Boolean(
    process.env.X_BEARER_TOKEN || (process.env.X_API_KEY && process.env.X_API_SECRET),
  );
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function withinBudget(): boolean {
  const day = today();
  if (day !== callDay) {
    callDay = day;
    callsToday = 0;
  }
  return callsToday < MAX_CALLS_PER_DAY;
}

/**
 * An app-only bearer token, minted from the client credentials.
 *
 * Cached in memory and re-minted if a lookup ever comes back unauthorised.
 * Never written to disk: it is derived from the secret, so it is as sensitive
 * as the secret and has no business outliving the process.
 */
async function appToken(): Promise<string | null> {
  if (cachedToken) return cachedToken;

  // The portal will hand you one directly. If it is there, use it.
  const ready = process.env.X_BEARER_TOKEN;
  if (ready) {
    cachedToken = ready;
    return cachedToken;
  }

  // The consumer pair, NOT the OAuth 2.0 client pair. See the header.
  const id = process.env.X_API_KEY;
  const secret = process.env.X_API_SECRET;
  if (!id || !secret) return null;

  const basic = Buffer.from(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`).toString(
    'base64',
  );

  try {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        authorization: `Basic ${basic}`,
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      console.warn(
        `[sface] xusers: token request returned ${response.status}. ` +
          'This endpoint wants the API Key and Secret, not the OAuth 2.0 client pair. ' +
          'Simplest fix is to set X_BEARER_TOKEN from the developer portal.',
      );
      return null;
    }

    const body = (await response.json()) as { access_token?: unknown };
    cachedToken = typeof body.access_token === 'string' ? body.access_token : null;
    return cachedToken;
  } catch (error) {
    console.warn('[sface] xusers: token request failed', error);
    return null;
  }
}

/**
 * Ask X for the biggest version of a profile picture it will serve.
 *
 * The API returns the `_normal` variant, which is 48 pixels square and looks
 * like a thumbnail stretched over a character's head, because that is what it
 * is. The 400 pixel variant is the same URL with the size swapped, and it is
 * the documented way to ask for it.
 */
function upscale(url: string): string {
  return url.replace(/_normal(\.[a-z]+)$/i, '_400x400$1');
}

/** Only https, and only a host X actually serves pictures from. */
function trustedImage(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    if (!['pbs.twimg.com', 'abs.twimg.com'].includes(url.hostname)) return null;
    return upscale(url.toString());
  } catch {
    return null;
  }
}

/**
 * Profile pictures for a set of handles, keyed by lowercase handle.
 *
 * Returns an empty map on absolutely any failure. A missing picture means a
 * generated figure, which is what the game drew before this file existed, so
 * nothing downstream has to handle an error case.
 */
export async function lookupAvatars(handles: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();

  const wanted = [...new Set(handles.map((h) => h.replace(/^@/, '').trim().toLowerCase()))]
    .filter((h) => /^[a-z0-9_]{1,15}$/.test(h))
    .slice(0, 100);

  if (wanted.length === 0 || !xusersConfigured() || !withinBudget()) return out;

  const token = await appToken();
  if (!token) return out;

  callsToday++;

  const query = new URLSearchParams({
    usernames: wanted.join(','),
    'user.fields': 'profile_image_url',
  });

  try {
    const response = await fetch(`${USERS_URL}?${query.toString()}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (response.status === 401 || response.status === 403) {
      // Expired, revoked, or the wrong credential. Drop it so the next
      // composition tries again rather than failing forever on a stale value.
      cachedToken = null;
      console.warn('[sface] xusers: lookup rejected the app token, dropping it');
      return out;
    }

    if (!response.ok) {
      console.warn(`[sface] xusers: lookup returned ${response.status}`);
      return out;
    }

    const body = (await response.json()) as {
      data?: Array<{ username?: unknown; profile_image_url?: unknown }>;
    };

    for (const user of body.data ?? []) {
      const handle = typeof user.username === 'string' ? user.username.toLowerCase() : null;
      const image = trustedImage(user.profile_image_url);
      if (handle && image) out.set(handle, image);
    }

    console.log(`[sface] xusers: ${out.size} of ${wanted.length} pictures resolved`);
    return out;
  } catch (error) {
    console.warn('[sface] xusers: lookup failed', error);
    return out;
  }
}

export { MAX_CALLS_PER_DAY };
