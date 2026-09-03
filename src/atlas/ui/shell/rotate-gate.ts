/*
 * "Turn your phone" for the play screens.
 *
 * The city is a third-person world with a joystick in one corner and actions in
 * the other; in portrait those corners are close enough together that the thumbs
 * overlap the play area, which is why every game in the reference reel is
 * landscape.
 *
 * It is a gate rather than a lock because a lock is not available. iOS Safari
 * does not implement screen.orientation.lock at all, and Android Chrome only
 * honours it in fullscreen, which a wallet Mini App is not. So the honest
 * mechanism is to refuse to run and say why.
 *
 * Only the play screens are gated. Menus, the guide and the payment sheets are
 * portrait-first by design and are read one-handed inside a wallet.
 */
export interface RotateGateOptions {
  /* Injected so the decision is testable without a browser. */
  readonly isPortrait: () => boolean;
  readonly reducedMotion?: boolean;
}

/* The screens that need the extra width. Everything else reads fine upright. */
const GATED_SCREENS = new Set(['beacon-commons', 'pay-harbor']);

export function screenNeedsLandscape(screen: string): boolean {
  return GATED_SCREENS.has(screen);
}

export function shouldGateForLandscape(screen: string, isPortrait: boolean): boolean {
  return screenNeedsLandscape(screen) && isPortrait;
}

export function rotateGate(options: RotateGateOptions): HTMLElement {
  const gate = document.createElement('section');
  gate.className = 'atlas-rotate-gate';
  gate.setAttribute('role', 'alertdialog');
  gate.setAttribute('aria-label', 'Turn your phone sideways to play');

  /*
   * The phone is drawn rather than shipped as an image: it is two nested
   * elements and a border, it scales to any screen without a second asset, and
   * it recolours with the palette.
   */
  const stage = document.createElement('div');
  stage.className = options.reducedMotion === true ? 'atlas-rotate-stage is-still' : 'atlas-rotate-stage';
  stage.setAttribute('aria-hidden', 'true');
  const phone = document.createElement('div');
  phone.className = 'atlas-rotate-phone';
  phone.append(document.createElement('span'));
  const arc = document.createElement('div');
  arc.className = 'atlas-rotate-arc';
  stage.append(arc, phone);

  const heading = document.createElement('p');
  heading.className = 'atlas-rotate-heading';
  heading.textContent = 'Turn your phone sideways';

  const reason = document.createElement('p');
  reason.className = 'atlas-rotate-reason';
  reason.textContent = 'NIM Atlas is played in landscape, so your thumbs stay clear of the city.';

  gate.append(stage, heading, reason);
  return gate;
}

/*
 * Calls back whenever the orientation changes.
 *
 * Both listeners are attached: orientationchange is the one older iOS fires,
 * and the media query is the one that is reliable everywhere else. Returns a
 * disposer, because a screen that stops being gated must stop listening.
 */
export function watchOrientation(onChange: () => void): () => void {
  const query = globalThis.matchMedia?.('(orientation: portrait)');
  query?.addEventListener('change', onChange);
  globalThis.addEventListener?.('orientationchange', onChange);
  return () => {
    query?.removeEventListener('change', onChange);
    globalThis.removeEventListener?.('orientationchange', onChange);
  };
}

export function isPortraitNow(): boolean {
  const query = globalThis.matchMedia?.('(orientation: portrait)');
  if (query) return query.matches;
  // Without matchMedia, fall back to the box itself rather than assuming.
  return (globalThis.innerHeight ?? 0) >= (globalThis.innerWidth ?? 0);
}
