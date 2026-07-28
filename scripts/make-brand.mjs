/**
 * The brand kit: every asset needed to set up the X developer app, the X
 * profile, and link previews, at the exact size and crop geometry each one
 * demands.
 *
 * Run with: npm run brand
 *
 * The crop rules are the whole reason this is a script rather than one square
 * exported four times. X crops an avatar to a circle, crops a header
 * differently on mobile than on web, and covers the header's bottom-left
 * corner with the avatar. An asset that ignores any of those looks broken on
 * the platform it was made for, and you only find out after uploading.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Raster, sdCircle, sdRoundedBox } from './lib/raster.mjs';
import { layoutText, measureText } from './lib/strokefont.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'brand');

// Mirrors src/render/theme.ts. Change one, change both.
const PAPER = '#f4ede0';
const INK = '#14110e';
const ACCENT = '#ff5a1f';
const DANGER = '#d3212c';
const RESCUE = '#2f7d63';
const PAPER_DEEP = '#ded2ba';

/** The mark, in a 0 to 1 square. Scaled into whatever box it is asked for. */
const CHART = [
  [0.14, 0.33], [0.266, 0.453], [0.375, 0.344],
  [0.484, 0.563], [0.609, 0.469], [0.719, 0.672],
];
const HEAD = { x: 0.719, y: 0.672, r: 0.09 };

/**
 * Draw the mark into a box.
 *
 * Ink is laid down first at a wider stroke than the accent, so the orange sits
 * in an ink keel. On a cream field an unoutlined orange line goes soft the
 * moment it is scaled down, and this mark has to survive being a 32 pixel
 * favicon and a 24 pixel avatar in a timeline.
 */
function drawMark(img, x, y, size) {
  const pt = ([px, py]) => [x + px * size, y + py * size];
  const line = [CHART.map(pt)];

  const keel = size * 0.078;
  const stroke = size * 0.051;

  img.stroke(line, keel, INK);
  img.circle(x + HEAD.x * size, y + HEAD.y * size, size * (HEAD.r + 0.0135), INK);

  img.stroke(line, stroke, ACCENT);
  img.circle(x + HEAD.x * size, y + HEAD.y * size, size * HEAD.r, ACCENT);

  // The face. Deadpan on purpose: it is not winking at the joke.
  const eye = size * 0.0176;
  img.circle(x + (HEAD.x - 0.031) * size, y + (HEAD.y - 0.0195) * size, eye, INK);
  img.circle(x + (HEAD.x + 0.031) * size, y + (HEAD.y - 0.0195) * size, eye, INK);
  img.rect(
    x + (HEAD.x - 0.035) * size,
    y + (HEAD.y + 0.0273) * size,
    size * 0.07,
    size * 0.0176,
    INK,
    size * 0.0088,
  );
}

/**
 * A small standing figure, used to populate the wider assets.
 *
 * The torso is an ink plate with the jacket inset inside it. The inset is
 * deliberately thin: at forty pixels tall a generous outline eats the jacket
 * entirely and every figure reads as the same black blob, which defeats the
 * only thing colour is doing here.
 */
function drawFigure(img, x, y, h, jacket, hostile = false) {
  const u = h / 38;
  const edge = Math.max(1.1, 1.5 * u);

  // Legs.
  img.stroke(
    [
      [[x - 1.5 * u, y + 6 * u], [x - 3.2 * u, y + 15 * u]],
      [[x + 1.5 * u, y + 6 * u], [x + 3.2 * u, y + 15 * u]],
    ],
    3.6 * u,
    INK,
  );

  // Torso.
  img.rect(x - 7 * u, y - 6.5 * u, 14 * u, 14 * u, INK, 4 * u);
  img.rect(
    x - 7 * u + edge,
    y - 6.5 * u + edge,
    14 * u - edge * 2,
    14 * u - edge * 2,
    jacket,
    3.2 * u,
  );

  // Arm, held out with something in it.
  img.stroke([[[x, y - 2 * u], [x + 12 * u, y - 2.6 * u]]], 4.4 * u, INK);
  img.stroke([[[x + 1 * u, y - 2 * u], [x + 10.5 * u, y - 2.5 * u]]], 4.4 * u - edge * 1.4, '#f2c9a0');

  // Head.
  img.circle(x, y - 15 * u, 9 * u, INK);
  img.circle(x, y - 15 * u, 9 * u - edge, hostile ? '#e0aa78' : '#f2c9a0');

  if (hostile) {
    img.rect(x - 8.2 * u, y - 17.4 * u, 16.4 * u, 4.4 * u, DANGER);
  } else {
    img.circle(x - 2.7 * u, y - 16 * u, 1.25 * u, INK);
    img.circle(x + 2.7 * u, y - 16 * u, 1.25 * u, INK);
  }
  img.rect(x - 2.2 * u, y - 12.2 * u, 4.4 * u, 1.4 * u, INK, 0.7 * u);
}

function text(img, string, opts) {
  const { colour = INK, weight, ...rest } = opts;
  img.stroke(layoutText(string, rest), weight, colour);
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

/**
 * Square app icon. Rounded plate, because this one is shown as a rounded
 * square by the X developer portal and by iOS.
 */
function appIcon(size) {
  const img = new Raster(size, size, null);
  const radius = size * 0.22;

  img.fill(
    (px, py) => sdRoundedBox(px, py, size / 2, size / 2, size / 2, size / 2, radius),
    PAPER,
  );
  drawMark(img, 0, 0, size);
  return img;
}

/**
 * Profile picture. X masks this to a circle, so the plate is a circle too and
 * the mark is pulled in to sit inside it with room to spare. A rounded square
 * uploaded here loses its corners and the mark loses its ends.
 */
function avatar(size) {
  const img = new Raster(size, size, null);
  img.circle(size / 2, size / 2, size / 2, PAPER);

  // Inset so nothing touches the crop edge, and nudged up-left because the
  // mark's visual mass sits low and right.
  const inset = size * 0.115;
  drawMark(img, inset * 0.6, -inset * 0.55, size - inset * 1.2);

  return img;
}

/**
 * X header, 1500 by 500.
 *
 * Two crops to respect. The avatar covers the bottom-left, roughly a 200 pixel
 * circle at this size, so nothing important goes there. And narrow viewports
 * trim the left and right edges, so the wordmark stays in the middle third.
 */
function header() {
  const W = 1500;
  const H = 500;
  const img = new Raster(W, H, PAPER);

  // The chart runs the full width and descends, because that is the premise.
  const points = [
    [-40, 250], [120, 300], [250, 235], [380, 330], [520, 280],
    [660, 375], [800, 320], [940, 405], [1090, 350], [1230, 430],
    [1380, 390], [1540, 455],
  ];

  // Ground mass under the line.
  const mass = [...points, [1540, H + 40], [-40, H + 40]];
  img.fill(
    (px, py) => (pointInPolygon(px, py, mass) ? -1 : 1),
    PAPER_DEEP,
    [0, 200, W, H],
  );

  img.stroke([points], 22, INK);
  img.stroke([points], 12, ACCENT);

  // Figures standing on the line, out of the avatar's corner.
  drawFigure(img, 700, 352, 62, ACCENT);
  drawFigure(img, 920, 296, 54, RESCUE);
  drawFigure(img, 1165, 382, 56, INK, true);

  // Wordmark, centred so a narrow crop keeps it.
  text(img, 'sFace', { x: W / 2, y: 96, size: 92, weight: 20, align: 'center', colour: INK });

  const line = 'SOMEBODY HAS TO SAVE FACE';
  const lineWidth = measureText(line, { size: 26, tracking: 1.6 });
  img.rect(W / 2 - lineWidth / 2 - 18, 212, lineWidth + 36, 52, ACCENT);
  text(img, line, {
    x: W / 2, y: 226, size: 26, weight: 6.5, align: 'center', tracking: 1.6, colour: INK,
  });

  return img;
}

/** Link preview card, 1200 by 630. Shown when the URL is posted anywhere. */
function ogCard() {
  const W = 1200;
  const H = 630;
  const img = new Raster(W, H, PAPER);

  img.rect(0, 0, W, 14, INK);
  img.rect(0, H - 14, W, 14, INK);

  drawMark(img, 44, 96, 340);

  text(img, 'sFace', { x: 400, y: 150, size: 104, weight: 22, colour: INK });

  const tag = "CRYPTO'S DOWN.";
  const tagW = measureText(tag, { size: 34, tracking: 1.2 });
  img.rect(400, 292, tagW + 30, 60, ACCENT);
  text(img, tag, { x: 415, y: 306, size: 34, weight: 8, tracking: 1.2, colour: INK });

  text(img, 'SOMEBODY HAS TO', { x: 400, y: 382, size: 34, weight: 8, tracking: 1.2, colour: INK });
  text(img, 'SAVE FACE.', { x: 400, y: 442, size: 34, weight: 8, tracking: 1.2, colour: INK });

  text(img, 'A NIMIQ PAY MINI APP', {
    x: 400, y: 528, size: 20, weight: 4.6, tracking: 2.4, colour: '#8c8378',
  });

  drawFigure(img, 1046, 468, 132, ACCENT);

  return img;
}

/** Wordmark on its own, for slides and the submission form. */
function wordmark(onInk) {
  const W = 900;
  const H = 280;
  const img = new Raster(W, H, onInk ? INK : PAPER);

  text(img, 'sFace', {
    x: W / 2, y: 78, size: 116, weight: 25, align: 'center',
    colour: onInk ? PAPER : INK,
  });

  const line = 'SOMEBODY HAS TO SAVE FACE';
  text(img, line, {
    x: W / 2, y: 222, size: 22, weight: 5.4, align: 'center', tracking: 2,
    colour: ACCENT,
  });

  return img;
}

/** A palette sheet, so nobody has to read the CSS to find a hex code. */
function palette() {
  const W = 1200;
  const H = 400;
  const img = new Raster(W, H, PAPER);

  const swatches = [
    ['CANVAS', PAPER], ['PAPER', PAPER_DEEP], ['INK', INK],
    ['ACCENT', ACCENT], ['DANGER', DANGER], ['RESCUE', RESCUE],
  ];

  text(img, 'sFace palette', { x: 60, y: 52, size: 44, weight: 10, colour: INK });

  const boxW = 165;
  swatches.forEach(([name, hex], i) => {
    const x = 60 + i * (boxW + 20);
    img.rect(x, 140, boxW, 130, INK);
    img.rect(x + 4, 144, boxW - 8, 122, hex);
    text(img, name, { x, y: 292, size: 17, weight: 4, tracking: 1, colour: INK });
    text(img, hex.replace('#', ''), { x, y: 322, size: 17, weight: 4, tracking: 1, colour: '#8c8378' });
  });

  return img;
}

/** Even-odd point in polygon. Only used for the header's ground mass. */
function pointInPolygon(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// ---------------------------------------------------------------------------

const TARGETS = [
  ['x-app-icon-400.png', () => appIcon(400), 'X developer portal, app icon'],
  ['x-app-icon-512.png', () => appIcon(512), 'spare, and the PWA icon'],
  ['app-icon-1024.png', () => appIcon(1024), 'masters, stores, print'],
  ['x-avatar-400.png', () => avatar(400), 'X profile picture, circle safe'],
  ['x-header-1500x500.png', () => header(), 'X profile header'],
  ['og-1200x630.png', () => ogCard(), 'link preview, og:image'],
  ['wordmark-light.png', () => wordmark(false), 'wordmark on cream'],
  ['wordmark-dark.png', () => wordmark(true), 'wordmark on ink'],
  ['palette.png', () => palette(), 'the six colours'],
];

mkdirSync(OUT, { recursive: true });

for (const [name, build, note] of TARGETS) {
  const png = build().toPNG();
  writeFileSync(join(OUT, name), png);
  console.log(`${name.padEnd(26)} ${(png.length / 1024).toFixed(1).padStart(7)} kB   ${note}`);
}

console.log(`\nWritten to brand/`);

