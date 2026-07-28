/**
 * Renders the app icon to PNG at the sizes the submission and iOS need.
 *
 * There is a perfectly good icon.svg, but the competition form and the iOS
 * home screen both want raster, and pulling in a headless browser or an image
 * library to convert one 512 pixel square would be a heavy dependency for a
 * file that changes never. So this rasterises the same shapes directly with
 * signed distance functions and writes the PNG by hand. Node ships zlib, which
 * is the only hard part of a PNG.
 *
 * Run with: npm run icons
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const PLATE = [0x14, 0x11, 0x0e];
const ACCENT = [0xff, 0x5a, 0x1f];
const PAPER = [0xf4, 0xed, 0xe0];

/** The chart line, in a 512 space. Same path as public/icon.svg. */
const CHART = [
  [72, 168], [136, 232], [192, 176], [248, 288], [312, 240], [368, 344],
];
const HEAD = { x: 368, y: 344, r: 46 };

const STROKE = 26;
const CORNER = 112;

// Signed distance helpers. Negative is inside, and the returned value is in
// pixels, which is what makes the antialiasing below a one liner.

function sdRoundedBox(px, py, half, radius) {
  const qx = Math.abs(px) - half + radius;
  const qy = Math.abs(py) - half + radius;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - radius;
}

function sdSegment(px, py, ax, ay, bx, by) {
  const pax = px - ax;
  const pay = py - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const h = Math.min(1, Math.max(0, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
  return Math.hypot(pax - bax * h, pay - bay * h);
}

function sdPolyline(px, py, points, width) {
  let best = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[i + 1];
    best = Math.min(best, sdSegment(px, py, ax, ay, bx, by));
  }
  return best - width / 2;
}

function sdCircle(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r;
}

function sdBox(px, py, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(px - cx) - halfW + radius;
  const qy = Math.abs(py - cy) - halfH + radius;
  return (
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
    Math.min(Math.max(qx, qy), 0) -
    radius
  );
}

/** Coverage from a distance, antialiased across one pixel of the output. */
function coverage(distance, pixel) {
  return Math.min(1, Math.max(0, 0.5 - distance / pixel));
}

function blend(dst, src, alpha) {
  for (let i = 0; i < 3; i++) dst[i] = Math.round(dst[i] * (1 - alpha) + src[i] * alpha);
}

/** Draw the icon at `size`, returning an RGBA buffer. */
function render(size) {
  const scale = size / 512;
  const pixel = 1 / scale;
  const rgba = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Sample at the pixel centre, in the 512 design space.
      const px = (x + 0.5) * pixel;
      const py = (y + 0.5) * pixel;

      const plate = coverage(sdRoundedBox(px - 256, py - 256, 256, CORNER), pixel);
      if (plate <= 0) continue;

      const colour = [...PAPER];

      // Ink first at a wider stroke, then the accent inside it. On a cream
      // plate an unoutlined orange line goes soft at favicon size; the ink
      // keel is what keeps the mark legible at 32 pixels.
      blend(colour, PLATE, coverage(sdPolyline(px, py, CHART, STROKE + 14), pixel));
      blend(colour, PLATE, coverage(sdCircle(px, py, HEAD.x, HEAD.y, HEAD.r + 7), pixel));
      blend(colour, ACCENT, coverage(sdPolyline(px, py, CHART, STROKE), pixel));
      blend(colour, ACCENT, coverage(sdCircle(px, py, HEAD.x, HEAD.y, HEAD.r), pixel));

      // Two eyes and a mouth, punched back out in the plate colour.
      blend(colour, PLATE, coverage(sdCircle(px, py, 352, 334, 9), pixel));
      blend(colour, PLATE, coverage(sdCircle(px, py, 384, 334, 9), pixel));
      blend(colour, PLATE, coverage(sdBox(px, py, 368, 362.5, 18, 4.5, 4.5), pixel));

      const offset = (y * size + x) * 4;
      rgba[offset] = colour[0];
      rgba[offset + 1] = colour[1];
      rgba[offset + 2] = colour[2];
      rgba[offset + 3] = Math.round(plate * 255);
    }
  }

  return rgba;
}

// Minimal PNG writer -------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(rgba, size) {
  // Each scanline is prefixed with a filter byte. Filter 0 is "none", which
  // costs a little file size and saves a lot of code.
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------

const TARGETS = [
  [512, 'icon-512.png'],
  [192, 'icon-192.png'],
  [180, 'icon-180.png'],
  [32, 'favicon-32.png'],
];

mkdirSync(OUT_DIR, { recursive: true });

for (const [size, name] of TARGETS) {
  const png = encodePng(render(size), size);
  writeFileSync(join(OUT_DIR, name), png);
  console.log(`${name.padEnd(16)} ${size}x${size}  ${(png.length / 1024).toFixed(1)} kB`);
}


