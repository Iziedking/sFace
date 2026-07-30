/**
 * Challenge links. This is the growth loop, so it stays simple and shareable.
 *
 * Deeplink format confirmed at https://nimiq.dev/mini-apps:
 *   nimiqpay://miniapp?url=your-app.com
 *
 * We hang our own challenge id off the app URL as a query param, so opening the
 * link inside Nimiq Pay lands the friend directly in the challenge.
 */

const APP_ORIGIN = import.meta.env.VITE_APP_ORIGIN ?? window.location.origin;

/** Build the nimiqpay:// link that opens this app at a specific challenge. */
export function challengeDeeplink(challengeId: string): string {
  const target = `${APP_ORIGIN}/?c=${encodeURIComponent(challengeId)}`;
  return `nimiqpay://miniapp?url=${encodeURIComponent(target)}`;
}

/**
 * Open this app inside Nimiq Pay, on whatever page asked for it.
 *
 * Every money path in sFace needs a wallet, and a wallet means Nimiq Pay. In a
 * plain browser those paths used to end at a sentence, which told the player
 * what was wrong and nothing about what to do next: they were left holding a
 * correct explanation and no way to act on it. This is the way out.
 *
 * `query` carries the destination through, so somebody who tried to stake on a
 * challenge lands back on that challenge rather than on the home page having
 * lost their place.
 */
export function openInNimiqPay(query?: string): string {
  const target = query ? `${APP_ORIGIN}/?${query}` : APP_ORIGIN;
  return `nimiqpay://miniapp?url=${encodeURIComponent(target)}`;
}

/** Read the challenge id when we were opened from a link. */
export function readChallengeId(): string | null {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('c');
  return id && id.length > 0 ? id : null;
}

/** The same trick for a clan invite. Opens the app with the tag filled in. */
export function clanDeeplink(tag: string): string {
  const target = `${APP_ORIGIN}/?clan=${encodeURIComponent(tag)}`;
  return `nimiqpay://miniapp?url=${encodeURIComponent(target)}`;
}

/**
 * Read a clan tag off an invite link.
 *
 * Shape-checked here rather than trusted, because it goes straight into the
 * join field and then into a request. Anything that is not a tag is treated as
 * no invite at all, which lands the player on the normal brief.
 */
export function readClanTag(): string | null {
  const params = new URLSearchParams(window.location.search);
  const tag = (params.get('clan') ?? '').trim().toUpperCase();
  return /^[A-Z0-9]{2,4}$/.test(tag) ? tag : null;
}

/**
 * X compose intent. No OAuth, no API key, no review. One line, works anywhere.
 * The deeplink goes in the url slot so tapping it in the post opens Nimiq Pay.
 */
export function shareToX(text: string, challengeId: string): string {
  // https, not the scheme. See shareableLink: X will not linkify nimiqpay://
  // and the post goes out looking broken.
  const url = challengeShareLink(challengeId);
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
}

/**
 * The same destinations as plain https, for anything that leaves the app.
 *
 * A nimiqpay:// URL is right for a button on our own page, where the OS holds
 * the scheme and the tap came from someone already here. It is wrong for a
 * post. X linkifies http and https and nothing else, so an invite went out as
 * dead text with the middle of it arbitrarily highlighted, and the one thing a
 * growth loop cannot afford is a link that looks broken to everybody who has
 * not already installed the wallet.
 *
 * Sharing the https link instead costs nothing and gains the handoff: the page
 * it opens knows the invite, knows whether it is inside Nimiq Pay, and can put
 * the wallet in front of the person itself rather than relying on a URL scheme
 * to have done it. The pitch happens where we control it.
 */
export function shareableLink(query: string): string {
  return `${APP_ORIGIN}/?${query}`;
}

/** A clan invite, as something a stranger can actually tap. */
export function clanShareLink(tag: string): string {
  return shareableLink(`clan=${encodeURIComponent(tag)}`);
}

/** A challenge, likewise. */
export function challengeShareLink(challengeId: string): string {
  return shareableLink(`c=${encodeURIComponent(challengeId)}`);
}
