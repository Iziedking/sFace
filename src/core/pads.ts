/**
 * On-screen control pads: where they are, in one place.
 *
 * ## Why this is its own module
 *
 * Two things need to agree about a button: the renderer that draws it and the
 * input layer that decides whether a thumb landed on it. If each works it out
 * for itself, they drift, and the failure is the worst kind of UI bug: the
 * button is visibly there, the player presses it, and nothing happens. Nobody
 * reports that as "the hit box is eight pixels off". They report that the game
 * is broken.
 *
 * So the layout is computed once from the canvas size and both sides read it.
 * Neither hardcodes a coordinate.
 *
 * ## Why pads at all, when the floating sticks are better
 *
 * They are better, for people who get on with them. A floating stick anchors
 * wherever the thumb lands, so nobody has to look down, and the aim stick gives
 * a full three hundred and sixty degrees from a thumb that barely moves.
 *
 * But "better on average" is not the same as "works for everyone". Plenty of
 * people have played games with a d-pad and a fire button their whole lives and
 * find an invisible stick under their thumb disorienting rather than freeing.
 * Telling them the scheme they want is worse is not a fix. So both exist, and
 * the setting decides.
 */

export interface PadRegion {
  /** Centre, in canvas CSS pixels. */
  x: number;
  y: number;
  r: number;
}

export interface PadLayout {
  /** The movement control on the left. Analog ring or d-pad, same footprint. */
  move: PadRegion;
  /** The big one on the right. */
  fire: PadRegion;
  /** Consumable slots, stacked above the fire button. */
  slots: PadRegion[];
  /** How many consumable buttons the layout has room for. */
  slotCount: number;
}

/** Thumb-sized. Anything smaller is a target you miss under pressure. */
const MOVE_RADIUS = 62;
const FIRE_RADIUS = 46;
const SLOT_RADIUS = 24;

/**
 * Distance from the screen edge.
 *
 * Generous, because a phone held in landscape has a palm resting where a thumb
 * needs to reach, and because the bottom corners of a modern phone are where
 * the home indicator lives.
 */
const EDGE = 26;

export function padLayout(width: number, height: number, slotCount: number): PadLayout {
  /*
   * Anchored to the bottom corners rather than centred vertically.
   *
   * In landscape the thumbs rest low and the middle of the screen is where the
   * game is. A control sitting halfway up the side covers the thing it is
   * being used to fly through.
   */
  const baseY = height - EDGE - MOVE_RADIUS;

  const move: PadRegion = {
    x: EDGE + MOVE_RADIUS,
    y: baseY,
    r: MOVE_RADIUS,
  };

  const fire: PadRegion = {
    x: width - EDGE - FIRE_RADIUS,
    y: baseY,
    r: FIRE_RADIUS,
  };

  /*
   * Slots arc up and to the left of the fire button, along the path a thumb
   * actually travels. A vertical stack would be easy to lay out and awkward to
   * reach, because a thumb pivots rather than sliding.
   */
  const slots: PadRegion[] = [];
  const arc = FIRE_RADIUS + SLOT_RADIUS + 16;

  /*
   * The step is derived, not chosen.
   *
   * Spacing them by eye put neighbours 38 pixels apart with a 24 pixel radius
   * each, so two buttons overlapped and a thumb aiming for one could take the
   * other. Under pressure that reads as the game buying the wrong thing.
   *
   * The chord between two points on the arc is 2 * arc * sin(step / 2), so the
   * smallest step that keeps them apart falls straight out of asking for that
   * chord to exceed two radii plus a gap.
   */
  const wanted = SLOT_RADIUS * 2 + 8;
  const step = 2 * Math.asin(Math.min(1, wanted / (2 * arc)));

  for (let i = 0; i < slotCount; i++) {
    // From straight up, sweeping toward the left, along the path a thumb
    // pivots rather than the line a layout tool would draw.
    const angle = -Math.PI / 2 - i * step;
    slots.push({
      x: fire.x + Math.cos(angle) * arc,
      y: fire.y + Math.sin(angle) * arc,
      r: SLOT_RADIUS,
    });
  }

  return { move, fire, slots, slotCount };
}

export function hit(region: PadRegion, x: number, y: number, slack = 8): boolean {
  return Math.hypot(x - region.x, y - region.y) <= region.r + slack;
}

/**
 * Which of the four directions a thumb at this point is asking for, as a unit
 * vector, or zero when it is resting in the middle.
 *
 * Used by both pad styles. The analog ring reads the full vector; the d-pad
 * snaps it to eight directions, which is what makes a d-pad feel like a d-pad
 * rather than a stick drawn as a cross.
 */
export function padVector(
  region: PadRegion,
  x: number,
  y: number,
  snap: boolean,
): { x: number; y: number } {
  const dx = x - region.x;
  const dy = y - region.y;
  const distance = Math.hypot(dx, dy);

  // A dead centre big enough that resting a thumb does not drift the ship.
  if (distance < region.r * 0.22) return { x: 0, y: 0 };

  const scale = Math.min(1, distance / (region.r * 0.82));
  let ux = dx / distance;
  let uy = dy / distance;

  if (snap) {
    // Eight-way. Round the angle to the nearest 45 degrees, so a diagonal is a
    // real diagonal and not a slightly-off vector that reads as drift.
    const step = Math.PI / 4;
    const angle = Math.round(Math.atan2(uy, ux) / step) * step;
    ux = Math.cos(angle);
    uy = Math.sin(angle);
    // A d-pad is on or off. Analog shading would defeat the point of choosing
    // it, which is knowing exactly what you are going to get.
    return { x: ux, y: uy };
  }

  return { x: ux * scale, y: uy * scale };
}
