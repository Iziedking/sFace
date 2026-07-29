/**
 * The browser half of connecting an X account.
 *
 * ## Why this is a redirect and not a popup
 *
 * It used to open a popup and listen for a postMessage, on the reasoning that a
 * full-page redirect would reload the game and drop a run in progress.
 *
 * That reasoning was wrong twice over. It fails on mobile, where browsers
 * refuse a blank popup navigated after an await and where Nimiq Pay's WebView
 * either ignores window.open entirely or escapes to the system browser, which
 * then has no opener to report back to. Connect X was dead on every phone, and
 * a phone is the device this game is actually for.
 *
 * And the run it was protecting does not exist. Connect X is reachable from the
 * gate, the brief, the results screen and CT Signals. There is no run in flight
 * on any of them. The popup was defending against a case that never happens, at
 * the cost of the case that always does.
 *
 * So: full-page redirect out, full-page redirect back, result read off the URL
 * fragment on boot. Nothing to block, nothing to postMessage, works everywhere.
 *
 * The profile is cached in local storage so a returning player is already
 * connected. It holds a handle, a display name and a picture URL, all of which
 * are public, and no token of any kind: the service never issues one to the
 * browser. See the header of server/xauth.ts for why nothing is stored there
 * either.
 */

const API_BASE = import.meta.env.VITE_API_BASE ?? '';
const STORAGE_KEY = 'sface.x';

export interface XProfile {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
}

let cached: XProfile | null | undefined;

/** The connected account, or null. Synchronous after the first call. */
export function connectedX(): XProfile | null {
  if (cached !== undefined) return cached;
  cached = read();
  return cached;
}

export function disconnectX(): void {
  cached = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode. It was never persisted anyway.
  }
}

/** True when this deployment has X connect configured. */
export async function xConnectAvailable(): Promise<boolean> {
  if (!API_BASE) return false;
  try {
    const response = await fetch(`${API_BASE}/x/config`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { enabled?: unknown };
    return body.enabled === true;
  } catch {
    return false;
  }
}

/**
 * Run the flow. Resolves with the profile, or null when the player declined,
 * closed the popup, or anything failed.
 *
 * The popup is opened synchronously, before the network call, because a popup
 * opened after an await is not a user gesture any more and every browser
 * blocks it.
 */
/**
 * Leave for X. Never resolves in any useful sense: the page is going away.
 *
 * Returns null only when the flow could not even be started, so a caller can
 * show a failure rather than sitting there waiting for a navigation that is
 * not coming.
 */
export async function connectX(): Promise<XProfile | null> {
  if (!API_BASE) return null;

  try {
    const response = await fetch(`${API_BASE}/x/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Where to come back to. Validated against the allow list on the service,
      // so this is a request rather than an instruction.
      body: JSON.stringify({ returnTo: window.location.origin }),
    });
    if (!response.ok) return null;

    const { url } = (await response.json()) as { url?: unknown };
    if (typeof url !== 'string') return null;

    window.location.href = url;

    // The navigation is under way. Hand back a promise that never settles so no
    // caller paints a "failed" state over a page that is already leaving.
    return new Promise<XProfile | null>(() => {});
  } catch {
    return null;
  }
}

/**
 * Read a result off the URL fragment, if we have just come back from X.
 *
 * Called once on boot, before anything renders. The fragment is stripped
 * immediately afterwards so a reload cannot replay it and the address bar does
 * not carry somebody's handle around for the rest of the session.
 *
 * Reuses parseProfile, which is the same validation the popup flow used: the
 * handle is shape-checked rather than trusted, because it arrives from outside
 * and ends up rendered next to a picture.
 */
export function takeRedirectResult(): XProfile | null {
  const hash = window.location.hash;
  const marker = '#sface-x=';
  if (!hash.startsWith(marker)) return null;

  // Cleared first, so a malformed payload cannot get stuck and replay forever.
  history.replaceState(null, '', window.location.pathname + window.location.search);

  try {
    const raw = hash.slice(marker.length).replace(/-/g, '+').replace(/_/g, '/');
    const profile = parseProfile(JSON.parse(atob(raw)));
    if (!profile) return null;

    cached = profile;
    write(profile);
    return profile;
  } catch {
    return null;
  }
}

function parseProfile(payload: unknown): XProfile | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const value = payload as Record<string, unknown>;
  if (value.ok !== true) return null;

  const profile = value.profile;
  if (typeof profile !== 'object' || profile === null) return null;
  const entry = profile as Record<string, unknown>;

  const handle = typeof entry.handle === 'string' ? entry.handle.toLowerCase() : '';
  if (!/^[a-z0-9_]{1,15}$/.test(handle)) return null;

  return {
    handle,
    displayName:
      typeof entry.displayName === 'string' && entry.displayName.length > 0
        ? entry.displayName.slice(0, 40)
        : `@${handle}`,
    avatarUrl: safeAvatar(entry.avatarUrl),
  };
}

/**
 * Only https, and only a host X actually serves pictures from. This URL ends
 * up as an image src, which is a request the player's device makes, so it does
 * not get to be an arbitrary endpoint.
 */
function safeAvatar(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    return ['pbs.twimg.com', 'abs.twimg.com'].includes(url.hostname) ? url.toString() : null;
  } catch {
    return null;
  }
}

function read(): XProfile | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? parseProfile({ ok: true, profile: JSON.parse(raw) }) : null;
  } catch {
    return null;
  }
}

function write(profile: XProfile): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Private mode. It lasts the session.
  }
}
