/**
 * A stroke font, because Node cannot load a typeface and the brand kit needs
 * words on it.
 *
 * Every glyph is a set of polylines in a 6 by 10 box, drawn with round caps.
 * That is not a compromise dressed up as a choice: the product's display face
 * is heavy, geometric and uppercase, and a thick round-capped stroke lands in
 * the same territory. It also means the wordmark is resolution independent and
 * identical on every machine, which a system font fallback would not be.
 *
 * Uppercase only, matching the headline style everywhere else in the product.
 * Lowercase input is uppercased on the way in rather than silently dropped.
 */

const G = {
  A: [[[0, 10], [3, 0], [6, 10]], [[1.1, 6.6], [4.9, 6.6]]],
  B: [
    [[0, 0], [0, 10]],
    [[0, 0], [4, 0], [5.4, 1.4], [5.4, 3.6], [4, 5], [0, 5]],
    [[0, 5], [4.2, 5], [5.6, 6.4], [5.6, 8.6], [4.2, 10], [0, 10]],
  ],
  C: [[[6, 1.7], [4.3, 0], [1.7, 0], [0, 1.7], [0, 8.3], [1.7, 10], [4.3, 10], [6, 8.3]]],
  D: [[[0, 0], [0, 10]], [[0, 0], [3.6, 0], [6, 2.4], [6, 7.6], [3.6, 10], [0, 10]]],
  E: [[[6, 0], [0, 0], [0, 10], [6, 10]], [[0, 5], [4.6, 5]]],
  F: [[[6, 0], [0, 0], [0, 10]], [[0, 5], [4.6, 5]]],
  G: [
    [[6, 1.7], [4.3, 0], [1.7, 0], [0, 1.7], [0, 8.3], [1.7, 10], [4.3, 10], [6, 8.3], [6, 5.6], [3.4, 5.6]],
  ],
  H: [[[0, 0], [0, 10]], [[6, 0], [6, 10]], [[0, 5], [6, 5]]],
  I: [[[3, 0], [3, 10]], [[1, 0], [5, 0]], [[1, 10], [5, 10]]],
  J: [[[5, 0], [5, 8.2], [3.6, 10], [1.4, 10], [0, 8.4]]],
  K: [[[0, 0], [0, 10]], [[6, 0], [0.4, 5.4]], [[1.8, 4.2], [6, 10]]],
  L: [[[0, 0], [0, 10], [6, 10]]],
  M: [[[0, 10], [0, 0], [3, 4.6], [6, 0], [6, 10]]],
  N: [[[0, 10], [0, 0], [6, 10], [6, 0]]],
  O: [[[1.7, 0], [4.3, 0], [6, 1.7], [6, 8.3], [4.3, 10], [1.7, 10], [0, 8.3], [0, 1.7], [1.7, 0]]],
  P: [[[0, 10], [0, 0], [4.2, 0], [5.8, 1.6], [5.8, 4], [4.2, 5.6], [0, 5.6]]],
  Q: [
    [[1.7, 0], [4.3, 0], [6, 1.7], [6, 8.3], [4.3, 10], [1.7, 10], [0, 8.3], [0, 1.7], [1.7, 0]],
    [[3.6, 6.9], [6.2, 10.4]],
  ],
  R: [[[0, 10], [0, 0], [4.2, 0], [5.8, 1.6], [5.8, 4], [4.2, 5.6], [0, 5.6]], [[3.2, 5.6], [6, 10]]],
  S: [
    [[6, 1.5], [4.3, 0], [1.7, 0], [0, 1.5], [0, 3.5], [1.7, 5], [4.3, 5], [6, 6.5], [6, 8.5], [4.3, 10], [1.7, 10], [0, 8.5]],
  ],
  T: [[[0, 0], [6, 0]], [[3, 0], [3, 10]]],
  U: [[[0, 0], [0, 8.3], [1.7, 10], [4.3, 10], [6, 8.3], [6, 0]]],
  V: [[[0, 0], [3, 10], [6, 0]]],
  W: [[[0, 0], [1.4, 10], [3, 4.2], [4.6, 10], [6, 0]]],
  X: [[[0, 0], [6, 10]], [[6, 0], [0, 10]]],
  Y: [[[0, 0], [3, 5], [6, 0]], [[3, 5], [3, 10]]],
  Z: [[[0, 0], [6, 0], [0, 10], [6, 10]]],

  0: [
    [[1.7, 0], [4.3, 0], [6, 1.7], [6, 8.3], [4.3, 10], [1.7, 10], [0, 8.3], [0, 1.7], [1.7, 0]],
    [[0.9, 8.6], [5.1, 1.4]],
  ],
  1: [[[1, 1.8], [3, 0], [3, 10]], [[1, 10], [5, 10]]],
  2: [[[0, 1.7], [1.7, 0], [4.3, 0], [6, 1.7], [6, 3.4], [0, 10], [6, 10]]],
  3: [[[0, 0], [6, 0], [2.6, 4.3]], [[2.6, 4.3], [4.6, 4.3], [6, 5.9], [6, 8.4], [4.3, 10], [1.4, 10], [0, 8.5]]],
  4: [[[4.6, 10], [4.6, 0], [0, 7], [6, 7]]],
  5: [[[6, 0], [0, 0], [0, 4.3], [4.2, 4.3], [6, 5.9], [6, 8.4], [4.3, 10], [1.4, 10], [0, 8.5]]],
  6: [
    [[6, 1.5], [4.3, 0], [1.7, 0], [0, 1.7], [0, 8.3], [1.7, 10], [4.3, 10], [6, 8.3], [6, 6.6], [4.3, 5], [1.4, 5], [0, 6.4]],
  ],
  7: [[[0, 0], [6, 0], [2.4, 10]]],
  8: [
    [[1.7, 5], [0, 3.4], [0, 1.7], [1.7, 0], [4.3, 0], [6, 1.7], [6, 3.4], [4.3, 5], [1.7, 5], [0, 6.6], [0, 8.3], [1.7, 10], [4.3, 10], [6, 8.3], [6, 6.6], [4.3, 5]],
  ],
  9: [
    [[0, 8.5], [1.7, 10], [4.3, 10], [6, 8.3], [6, 1.7], [4.3, 0], [1.7, 0], [0, 1.7], [0, 3.4], [1.7, 5], [4.6, 5], [6, 3.5]],
  ],

  "'": [[[3, 0], [3, 2.8]]],
  '.': [[[3, 9.7], [3, 10]]],
  ',': [[[3, 9.4], [2.1, 11.2]]],
  '-': [[[1, 5.2], [5, 5.2]]],
  ':': [[[3, 3], [3, 3.3]], [[3, 7.2], [3, 7.5]]],
  '!': [[[3, 0], [3, 6.6]], [[3, 9.7], [3, 10]]],
  '?': [[[0, 1.7], [1.7, 0], [4.3, 0], [6, 1.7], [6, 3.2], [3, 5.2], [3, 6.8]], [[3, 9.7], [3, 10]]],
  '/': [[[5.4, 0], [0.6, 10]]],
  '@': [
    [[4.6, 6.4], [3, 7.2], [1.6, 6.4], [1.6, 4.4], [3, 3.6], [4.6, 4.4], [4.6, 6.8], [5.6, 7.4], [6, 5.6], [6, 2], [4.3, 0], [1.7, 0], [0, 1.7], [0, 8.3], [1.7, 10], [4.6, 10]],
  ],
};

/**
 * Lowercase, only where the brand actually needs it.
 *
 * The product is "sFace" and the lowercase s is half the joke, so a wordmark
 * set in full caps quietly loses it. These sit on an x-height band from 3 to
 * 10 rather than the full box. Anything without a lowercase form here falls
 * back to its capital, which is the right failure: a stray capital in a word
 * is legible, a missing glyph is not.
 */
const LOWER = {
  a: [
    [[0, 4.3], [1.6, 3], [4.4, 3], [6, 4.4], [6, 10]],
    [[6, 6.8], [1.8, 6.8], [0.2, 8], [0.2, 8.9], [1.8, 10], [4.4, 10], [6, 8.7]],
  ],
  c: [[[6, 4.3], [4.4, 3], [1.6, 3], [0, 4.4], [0, 8.6], [1.6, 10], [4.4, 10], [6, 8.7]]],
  e: [
    [[0, 6.7], [6, 6.7], [6, 4.4], [4.4, 3], [1.6, 3], [0, 4.4], [0, 8.6], [1.6, 10], [4.4, 10], [6, 8.7]],
  ],
  s: [
    [[6, 4.2], [4.4, 3], [1.6, 3], [0, 4.2], [0, 5.3], [1.6, 6.5], [4.4, 6.5], [6, 7.7], [6, 8.8], [4.4, 10], [1.6, 10], [0, 8.8]],
  ],
  o: [[[1.6, 3], [4.4, 3], [6, 4.4], [6, 8.6], [4.4, 10], [1.6, 10], [0, 8.6], [0, 4.4], [1.6, 3]]],
  n: [[[0, 3], [0, 10]], [[0, 4.4], [1.6, 3], [4.4, 3], [6, 4.4], [6, 10]]],
  v: [[[0, 3], [3, 10], [6, 3]]],
};

/** Glyph box, in font units. */
const UNIT_W = 6;
const UNIT_H = 10;
/** Gap between glyphs, in font units. */
const TRACKING = 2.2;
const SPACE_W = 3.6;

/**
 * Lay a string out as polylines in pixel space.
 *
 * @param {string} text
 * @param {object} options
 * @param {number} options.x left edge, or the anchor when align is set
 * @param {number} options.y cap height top
 * @param {number} options.size cap height in pixels
 * @param {number} [options.tracking] extra letter spacing, in font units
 * @param {'left'|'center'|'right'} [options.align]
 * @returns {Array<Array<[number,number]>>}
 */
export function layoutText(text, { x, y, size, tracking = 0, align = 'left' }) {
  const scale = size / UNIT_H;
  const advance = (UNIT_W + TRACKING + tracking) * scale;
  const spaceAdvance = (SPACE_W + TRACKING + tracking) * scale;

  // Case is preserved rather than flattened, so a lowercase letter with a
  // drawn form gets it and everything else falls back to its capital.
  const chars = [...text];
  const width = measureText(text, { size, tracking });

  let cursor = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;

  const out = [];
  for (const char of chars) {
    if (char === ' ') {
      cursor += spaceAdvance;
      continue;
    }

    const glyph = LOWER[char] ?? G[char.toUpperCase()];
    if (!glyph) {
      // Unknown characters advance rather than vanish, so a typo shows up as
      // a gap in the artwork instead of silently reflowing everything.
      cursor += advance;
      continue;
    }

    for (const points of glyph) {
      out.push(points.map(([gx, gy]) => [cursor + gx * scale, y + gy * scale]));
    }
    cursor += advance;
  }

  return out;
}

export function measureText(text, { size, tracking = 0 }) {
  const scale = size / UNIT_H;
  const advance = (UNIT_W + TRACKING + tracking) * scale;
  const spaceAdvance = (SPACE_W + TRACKING + tracking) * scale;

  let width = 0;
  const chars = [...text];
  for (const char of chars) {
    width += char === ' ' ? spaceAdvance : advance;
  }
  // The last glyph does not need trailing tracking.
  const last = chars[chars.length - 1];
  if (last) width -= (TRACKING + tracking) * scale;
  return Math.max(0, width);
}

export { UNIT_H, UNIT_W };
