/**
 * Where the button that opens a cell sits, so it can be drawn and tapped from
 * one description.
 *
 * ## Why this exists
 *
 * Opening a cell costs a charge, and the only way to spend one was to find
 * CHARGE in the consumable row and press it. The level said "TAP CHARGE TO BLOW
 * THE DOOR", which names the control without saying where it is, and on a phone
 * that row is four small circles along the bottom edge that most players never
 * look at.
 *
 * Reported as not knowing where to tap, with the obvious suggestion attached:
 * tap the cage. It is on screen, it is the thing being acted on, and it is
 * already the only thing in reach. So the cage gets its own button.
 *
 * ## Why a button and not the cage itself
 *
 * A bare tap on the cage would have to be taken out of the aim and fire layer,
 * which owns every tap on that half of the screen. Stealing taps near a cage
 * would mean the gun sometimes does not answer, which trades a discoverability
 * problem for a responsiveness one.
 *
 * A drawn button takes only its own circle, and it says what it costs.
 *
 * Nothing here draws or listens. It is arithmetic about a circle, which is why
 * it can be tested without a canvas or a pointer.
 */

/** A tappable circle, in canvas CSS pixels. */
export interface BreachButton {
  x: number;
  y: number;
  r: number;
}

/** How big the button is. A comfortable thumb target, and no bigger. */
const RADIUS = 30;

/**
 * How far above the cell it floats, measured from the cell's centre.
 *
 * Clear of the name plate that sits just under the cage. At 52 the button
 * covered it, which hid the one thing telling you who you were about to let
 * out.
 */
const LIFT = 76;

/**
 * The button for a cell at this point on screen, kept inside the canvas.
 *
 * `cell` is the cell's centre in canvas pixels, which the caller gets by
 * projecting the world position through the camera. Clamped to the viewport
 * because a cell can sit near an edge, and a button half off the screen is a
 * button somebody cannot press.
 *
 * The clamp is to the play area rather than the whole canvas: the top strip is
 * the HUD, which owns its own taps, and a button under it would be both
 * invisible and stealing presses from the pause control.
 */
export function breachButtonAt(input: {
  cell: { x: number; y: number };
  width: number;
  height: number;
  /** Top of the play area, below the HUD strip. */
  top: number;
}): BreachButton {
  const margin = RADIUS + 8;

  return {
    x: Math.max(margin, Math.min(input.width - margin, input.cell.x)),
    y: Math.max(input.top + margin, Math.min(input.height - margin, input.cell.y - LIFT)),
    r: RADIUS,
  };
}

/**
 * Whether a tap landed on the button.
 *
 * Slack is generous because this is a single target with nothing beside it, so
 * unlike the gate card's rows there is no neighbour for a loose hit to steal.
 */
export function breachHit(button: BreachButton, x: number, y: number, slack = 8): boolean {
  return Math.hypot(x - button.x, y - button.y) <= button.r + slack;
}
