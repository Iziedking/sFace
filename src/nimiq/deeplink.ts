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
  const url = challengeDeeplink(challengeId);
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
}
