/**
 * The browser half of connecting an X account.
 *
 * The flow opens in a popup and reports back by postMessage, which is the only
 * shape that does not destroy a run in progress. A full-page redirect would
 * reload the game, drop the run, and reset the level, and doing that to
 * somebody mid-flight to render a small picture is a bad trade.
 *
 * The profile is cached in local storage so a returning player is already
 * connected. It holds a handle, a display name and a picture URL, all of which
 * are public, and no token of any kind: the service never issues one to the
 * browser. See the header of server/xauth.ts for why nothing is stored there
 * either.
 */

const API_BASE = import.meta.env.VITE_API_BASE ?? '';
const STORAGE_KEY = 'sface.x';
const POPUP_TIMEOUT_MS = 3 * 60_000;

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
export async function connectX(): Promise<XProfile | null> {
  if (!API_BASE) return null;

  const popup = window.open('', 'sface-x', 'width=520,height=720');
  if (!popup) return null;

  try {
    const response = await fetch(`${API_BASE}/x/start`, { method: 'POST' });
    if (!response.ok) {
      popup.close();
      return null;
    }

    const { url } = (await response.json()) as { url?: unknown };
    if (typeof url !== 'string') {
      popup.close();
      return null;
    }

    popup.location.href = url;
    const profile = await waitForResult(popup);

    if (profile) {
      cached = profile;
      write(profile);
    }
    return profile;
  } catch {
    try {
      popup.close();
    } catch {
      // Already gone.
    }
    return null;
  }
}

function waitForResult(popup: Window): Promise<XProfile | null> {
  return new Promise((resolve) => {
    let settled = false;

    const finish = (profile: XProfile | null): void => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      clearInterval(closedWatch);
      clearTimeout(timeout);
      resolve(profile);
    };

    const onMessage = (event: MessageEvent): void => {
      // Only our own service may report a result. Without this check any page
      // the player has open could hand us an identity.
      if (!isTrustedOrigin(event.origin)) return;

      const data = event.data as { source?: unknown; payload?: unknown };
      if (!data || data.source !== 'sface-x') return;

      finish(parseProfile(data.payload));
    };

    window.addEventListener('message', onMessage);

    // A player who closes the popup has answered. Poll for it, because there
    // is no event for someone else's window closing.
    const closedWatch = window.setInterval(() => {
      if (popup.closed) finish(null);
    }, 600);

    const timeout = window.setTimeout(() => {
      try {
        popup.close();
      } catch {
        // Already gone.
      }
      finish(null);
    }, POPUP_TIMEOUT_MS);
  });
}

function isTrustedOrigin(origin: string): boolean {
  try {
    return new URL(API_BASE, window.location.origin).origin === origin;
  } catch {
    return false;
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
