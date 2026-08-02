/**
 * The gate card lists its options as 1, 2 and 3.
 *
 * That is a keyboard instruction, and on a phone there is no keyboard. The rows
 * were answerable only through the consumable strip along the bottom, which is
 * a mapping nothing on screen explains and which is off the fold entirely on a
 * short landscape viewport. Reported as there being no way to choose.
 *
 * So the rows are tappable, which means where they are drawn and where a tap
 * counts have to be the same rectangle. Both sides read this module, and these
 * pin what it returns.
 */

import { describe, expect, it } from 'vitest';

import { gateCardLayout, rowAt } from '../src/core/gatecard';

/** The wallet in landscape, which is the screen that decides. */
const SHORT = { width: 660, height: 280, top: 46, optionCount: 3, hasReadLine: true };
/** A phone held upright, where the card can afford to be centred. */
const TALL = { width: 390, height: 780, top: 46, optionCount: 3, hasReadLine: true };

describe('where the card sits', () => {
  it('docks left on a short screen so the middle stays clear', () => {
    const layout = gateCardLayout(SHORT);

    expect(layout.short).toBe(true);
    expect(layout.x).toBeLessThan(20);
    // The lane the player flies through is the middle. Nothing may cover it.
    expect(layout.x + layout.width).toBeLessThan(SHORT.width / 2 + 20);
  });

  it('centres on a tall screen, where it sits above the player', () => {
    const layout = gateCardLayout(TALL);

    expect(layout.short).toBe(false);
    const middle = layout.x + layout.width / 2;
    expect(Math.abs(middle - TALL.width / 2)).toBeLessThanOrEqual(1);
  });

  it('never runs off a narrow screen', () => {
    const layout = gateCardLayout({ ...SHORT, width: 320 });
    expect(layout.x + layout.width).toBeLessThanOrEqual(320);
  });

  it('leaves the pause control alone when centred', () => {
    // The pause control owns the top centre, so a centred card has to clear it.
    expect(gateCardLayout(TALL).y).toBeGreaterThan(TALL.top + 30);
  });

  it('sits right under the bar when docked, where the gap is not needed', () => {
    expect(gateCardLayout(SHORT).y).toBeLessThan(SHORT.top + 20);
  });
});

describe('tapping a row', () => {
  it('gives back the option that was drawn there', () => {
    const layout = gateCardLayout(SHORT);

    layout.rows.forEach((row, index) => {
      const x = row.x + row.width / 2;
      const y = row.y + row.height / 2;
      expect(rowAt(layout, x, y)).toBe(index);
    });
  });

  it('has one row per option and no more', () => {
    expect(gateCardLayout(SHORT).rows).toHaveLength(3);
    expect(gateCardLayout({ ...SHORT, optionCount: 2 }).rows).toHaveLength(2);
  });

  it('does not answer for a tap beside the card', () => {
    // The play area is not a giant answer button.
    const layout = gateCardLayout(SHORT);
    expect(rowAt(layout, layout.x + layout.width + 40, layout.rows[0]!.y + 8)).toBeNull();
  });

  it('does not answer for a tap on the title strip', () => {
    const layout = gateCardLayout(SHORT);
    expect(rowAt(layout, layout.x + 20, layout.y + 4)).toBeNull();
  });

  it('never answers the row above the one that was aimed at', () => {
    /*
     * The rows are contiguous, so the boundary between them is exact and there
     * is nothing to forgive there. Growing each row by a few pixels and taking
     * the first match would have made a tap just above row two land in row
     * one's slack. On a gate a wrong answer wakes the street, so that is a
     * punishment for aiming slightly high rather than a rounding error.
     */
    const layout = gateCardLayout(SHORT);
    const row = layout.rows[1]!;

    expect(rowAt(layout, row.x + 30, row.y + 1)).toBe(1);
    expect(rowAt(layout, row.x + 30, row.y + row.height - 1)).toBe(1);
  });

  it('forgives a thumb landing just under the last row', () => {
    // A thumb is wider than a 22 pixel band, and the edge of the card is where
    // somebody reaching for the bottom option actually lands.
    const layout = gateCardLayout(SHORT);
    const last = layout.rows[layout.rows.length - 1]!;

    expect(rowAt(layout, last.x + 30, last.y + last.height + 4)).toBe(last.index);
  });

  it('gives up once a tap is nowhere near a row', () => {
    const layout = gateCardLayout(SHORT);
    const last = layout.rows[layout.rows.length - 1]!;

    expect(rowAt(layout, last.x + 30, last.y + last.height + 60)).toBeNull();
  });

  it('keeps the rows inside the card', () => {
    const layout = gateCardLayout(SHORT);
    const last = layout.rows[layout.rows.length - 1]!;
    expect(last.y + last.height).toBeLessThanOrEqual(layout.y + layout.height);
  });
});
