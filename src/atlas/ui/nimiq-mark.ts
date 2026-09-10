/**
 * The Nimiq brand mark, in one place.
 *
 * Nimiq appeared on none of the sixteen shipped screenshots, including the
 * payment review, which is the one screen where a player is asked to approve a
 * real transfer. These are the official files from github.com/nimiq/designs,
 * downloaded rather than redrawn: an approximated mark shown to the Nimiq team
 * is worse than no mark.
 *
 * Two rules this module exists to hold:
 *
 * 1. **Referenced, never inlined.** Both official files declare
 *    `id="radial-gradient"` and a `.cls-1` class. Two inlined copies in one
 *    document would share those ids, so the second mark's gradient would
 *    resolve against the first one's definition. An `<img>` keeps each file in
 *    its own document.
 * 2. **Never recoloured.** The product's own rule is that magenta is the only
 *    accent and orange is demoted to a warning role. The resolution is not to
 *    tint Nimiq's artwork to fit, but to treat it as a brand mark rather than a
 *    UI accent, and leave its official gradient alone.
 */

/** The hexagon signet alone, for tight spaces like the play HUD. */
export const NIMIQ_SIGNET_SRC = '/atlas/brand/nimiq-signet.svg';

/** Signet plus white wordmark, for dark glass panels. */
export const NIMIQ_LOCKUP_SRC = '/atlas/brand/nimiq-logo-horizontal.svg';

export type AtlasNimiqMarkVariant = 'signet' | 'lockup';

/**
 * Build a Nimiq mark image.
 *
 * `decorative` drops it from the accessibility tree, for the play HUD where the
 * surrounding control already carries a label and a second "Nimiq" would just
 * be noise a screen reader repeats on every screen.
 */
export function createNimiqMark(
  variant: AtlasNimiqMarkVariant,
  options: { readonly decorative?: boolean; readonly className?: string } = {},
): HTMLImageElement {
  const image = document.createElement('img');
  image.className = options.className ? `atlas-nimiq-mark ${options.className}` : 'atlas-nimiq-mark';
  image.dataset.variant = variant;
  image.src = variant === 'signet' ? NIMIQ_SIGNET_SRC : NIMIQ_LOCKUP_SRC;
  image.alt = options.decorative ? '' : variant === 'signet' ? 'Nimiq' : 'Built on Nimiq';
  if (options.decorative) image.setAttribute('aria-hidden', 'true');
  // The mark sits on first paint of the title and loading screens, so it is not
  // lazy, but it must never block the frame either.
  image.decoding = 'async';
  image.draggable = false;
  return image;
}
