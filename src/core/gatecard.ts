/**
 * Where the gate card sits, so it can be drawn and tapped from one description.
 *
 * ## Why this is not just in the HUD
 *
 * The card lists its options as numbered rows, and the numbers are keys: 1, 2,
 * 3. On a keyboard that works. On a phone there is no keyboard, and the numbers
 * were being answered through the consumable strip along the bottom, which is
 * an indirect mapping nothing on screen explains and which is off the fold
 * entirely on a short landscape viewport. Reported as there being no way to
 * choose.
 *
 * The obvious answer is to tap the row you want. That needs the input layer to
 * know exactly where the rows were drawn, and the two agreeing by coincidence
 * is how a hit target ends up a few pixels off the thing it belongs to. So the
 * geometry lives here and both sides read it.
 *
 * Nothing in this file draws or listens. It is arithmetic about a rectangle,
 * which is why it can be tested without a canvas or a pointer.
 */

/** A tappable row on the card, in canvas CSS pixels. */
export interface GateRow {
  /** Index of the option, which is also the key that answers it. */
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GateCardLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Height of the title strip above the first row. */
  headH: number;
  rowH: number;
  /** True when the screen is too short to centre the card over the play area. */
  short: boolean;
  rows: GateRow[];
}

/**
 * Below this the card cannot be centred without covering the flying lane.
 *
 * The wallet in landscape is about 280 tall and the card is a hundred of that.
 * Centred, it sits exactly across the band the player and everything shooting
 * at them are moving through.
 */
const SHORT_SCREEN = 520;

export function gateCardLayout(input: {
  width: number;
  /** Canvas height, which decides whether the card can be centred. */
  height: number;
  /** Top of the play area, below the HUD strip. */
  top: number;
  optionCount: number;
  /** True when a line about buying a read is printed under the rows. */
  hasReadLine: boolean;
}): GateCardLayout {
  const short = input.height < SHORT_SCREEN;

  const rowH = short ? 22 : 26;
  const headH = short ? 24 : 28;
  const width = Math.min(input.width - 24, short ? 320 : 430);

  // Docked left on a short screen so the middle stays clear; centred otherwise.
  const x = short ? 12 : (input.width - width) / 2;
  // Docked, it does not have to clear the pause control that owns the top
  // centre, and every row of vertical space matters more than the gap does.
  const y = short ? input.top + 6 : input.top + 44;

  const height = headH + input.optionCount * rowH + (input.hasReadLine ? 20 : 8);

  const rows: GateRow[] = [];
  for (let index = 0; index < input.optionCount; index++) {
    rows.push({
      index,
      x,
      y: y + headH + index * rowH,
      width,
      height: rowH,
    });
  }

  return { x, y, width, height, headH, rowH, short, rows };
}

/**
 * Which row a tap landed on, or null.
 *
 * ## Exact first, then nearest
 *
 * A thumb is wider than a 22 pixel band, so a tap a few pixels off a row was
 * clearly meant for it and should count. The obvious way to allow that is to
 * grow every row by a few pixels and take the first match, and it is wrong:
 * grown bands overlap their neighbours, so a tap just above row two lands in
 * row one's slack and answers the wrong option. On a gate a wrong answer wakes
 * the street, so this is not a rounding error, it is a punishment for aiming
 * slightly high.
 *
 * A point inside a row exactly is that row. A point outside every row falls to
 * whichever centre is closest, and only if it is close enough to have been
 * meant. Overlap cannot happen because nearest is a single answer.
 */
export function rowAt(layout: GateCardLayout, x: number, y: number, slack = 6): number | null {
  if (layout.rows.length === 0) return null;

  const first = layout.rows[0]!;
  if (x < first.x || x > first.x + first.width) return null;

  for (const row of layout.rows) {
    if (y >= row.y && y <= row.y + row.height) return row.index;
  }

  let best: GateRow | null = null;
  let bestGap = Infinity;
  for (const row of layout.rows) {
    const centre = row.y + row.height / 2;
    const gap = Math.abs(y - centre);
    if (gap < bestGap) {
      bestGap = gap;
      best = row;
    }
  }

  // Half a row plus the slack: any further and it was not aimed at a row.
  if (!best || bestGap > best.height / 2 + slack) return null;
  return best.index;
}
