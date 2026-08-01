/**
 * How tall the screen actually is, as opposed to how tall it claims to be.
 *
 * ## The problem
 *
 * A phone has two viewports. The LAYOUT viewport is the box CSS lays out
 * against, and on Android it is sized as though the browser chrome were
 * collapsed. The VISUAL viewport is what a person can see right now.
 *
 * Most of the time they agree. They do not agree inside an in-app WebView with
 * a chrome bar that never collapses, which is exactly where this game runs:
 * Nimiq Pay on Android reported roughly a chrome bar more height than it was
 * showing, so the consumable strip along the bottom was drawn at coordinates
 * below the visible area. The buttons were correct, painted, and unreachable.
 *
 * iOS resolves fixed elements against the visual viewport, which is why the
 * same build was fine on an iPhone and cut off on a Pixel. A bug that only
 * exists on hardware you do not have is worth a file with its reasoning in it.
 *
 * ## Why a CSS variable rather than sizing the canvas directly
 *
 * The renderer already measures its own element and the HUD already works in
 * CSS pixels off that measurement. Correct the box and everything downstream is
 * correct for free, including the pads, the safe areas and the screens layer.
 * Reaching into the canvas instead would fix the drawing and leave the DOM
 * screens still overflowing.
 */

let stop: (() => void) | null = null;

/**
 * Start correcting the app box, and keep it corrected.
 *
 * Safe to call more than once; the previous listeners are dropped first. Does
 * nothing at all where `visualViewport` is missing, which leaves the CSS
 * fallbacks (`100dvh`, then `100%`) in charge rather than replacing a working
 * value with a guess.
 */
export function trackViewport(): void {
  stop?.();

  const vv = window.visualViewport;
  if (!vv) return;

  let raf = 0;
  let applied = 0;

  const apply = (): void => {
    cancelAnimationFrame(raf);
    // Coalesced into a frame. Rotating a phone fires a burst of these, and each
    // one that reaches the style sets off a resize and a canvas reallocation.
    raf = requestAnimationFrame(() => {
      /*
       * Rounded up, not down.
       *
       * visualViewport.height is fractional on scaled displays, and flooring it
       * leaves a hairline of background along the bottom edge that reads as a
       * rendering fault rather than as a rounding one.
       */
      const height = Math.ceil(vv.height);
      if (height <= 0 || height === applied) return;

      applied = height;
      document.documentElement.style.setProperty('--app-h', `${height}px`);

      /*
       * Tell the renderer the box moved.
       *
       * The visual viewport can change without a window resize: chrome sliding
       * in on Android, a keyboard opening, a rotation that keeps the same area.
       * The canvas measures its own element on window resize and nowhere else,
       * so without this the box is corrected in CSS and the backing store keeps
       * the old height, which is the same cut-off wearing a different hat.
       *
       * Guarded on the height actually changing, so this cannot feed itself.
       */
      window.dispatchEvent(new Event('resize'));
    });
  };

  vv.addEventListener('resize', apply);
  /*
   * Scroll too, because pinch-zooming moves the visual viewport without
   * resizing it, and a page zoomed and released should settle back to a box
   * that matches what is on screen.
   */
  vv.addEventListener('scroll', apply);
  window.addEventListener('orientationchange', apply);

  apply();

  stop = () => {
    cancelAnimationFrame(raf);
    vv.removeEventListener('resize', apply);
    vv.removeEventListener('scroll', apply);
    window.removeEventListener('orientationchange', apply);
    stop = null;
  };
}
