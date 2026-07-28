/**
 * A tiny software rasteriser and PNG writer.
 *
 * The repo has no image dependency and does not want one. Pulling in a
 * headless browser or a canvas binding to draw a handful of flat shapes would
 * be a large, platform-specific dependency for output that changes about twice
 * a year, so the shapes are evaluated as signed distance fields and the PNG is
 * written by hand. Node ships zlib, which is the only genuinely hard part.
 *
 * Signed distance fields are the right tool here specifically because
 * antialiasing falls out of them for free: the distance is in pixels, so
 * coverage is one clamp of it, and every edge comes out clean without
 * supersampling.
 *
 * Every draw takes a bounding box. Without one, a 1500 by 500 banner would
 * evaluate every shape against 750,000 pixels and a page of text would take
 * minutes. With one, each glyph only touches the pixels it could possibly
 * cover.
 */

import { deflateSync } from 'node:zlib';

// Signed distance helpers. Negative is inside. Values are in pixels, which is
// what makes the antialiasing below a one liner.

export function sdRoundedBox(px, py, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(px - cx) - halfW + radius;
  const qy = Math.abs(py - cy) - halfH + radius;
  return (
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius
  );
}

export function sdCircle(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r;
}

function sdSegment(px, py, ax, ay, bx, by) {
  const pax = px - ax;
  const pay = py - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const denom = bax * bax + bay * bay;
  const h = denom === 0 ? 0 : Math.min(1, Math.max(0, (pax * bax + pay * bay) / denom));
  return Math.hypot(pax - bax * h, pay - bay * h);
}

/** Distance to a set of polylines, stroked to `width` with round caps. */
export function sdPolylines(px, py, polylines, width) {
  let best = Infinity;
  for (const points of polylines) {
    if (points.length === 1) {
      best = Math.min(best, Math.hypot(px - points[0][0], py - points[0][1]));
      continue;
    }
    for (let i = 0; i < points.length - 1; i++) {
      const [ax, ay] = points[i];
      const [bx, by] = points[i + 1];
      best = Math.min(best, sdSegment(px, py, ax, ay, bx, by));
      if (best <= 0) break;
    }
  }
  return best - width / 2;
}

/** Bounding box of a set of polylines, grown by half the stroke and a margin. */
export function boundsOf(polylines, width) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;

  for (const points of polylines) {
    for (const [x, y] of points) {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }

  const pad = width / 2 + 2;
  return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
}

export function hexToRgb(hex) {
  const value = hex.replace('#', '');
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

export class Raster {
  /**
   * @param {number} width
   * @param {number} height
   * @param {string|null} background hex, or null for transparent
   */
  constructor(width, height, background = null) {
    this.width = width;
    this.height = height;
    this.data = Buffer.alloc(width * height * 4);

    if (background) {
      const [r, g, b] = hexToRgb(background);
      for (let i = 0; i < width * height; i++) {
        this.data[i * 4] = r;
        this.data[i * 4 + 1] = g;
        this.data[i * 4 + 2] = b;
        this.data[i * 4 + 3] = 255;
      }
    }
  }

  /**
   * Composite a shape.
   *
   * @param {(px:number,py:number)=>number} distance signed distance, in pixels
   * @param {string} hex
   * @param {[number,number,number,number]} [bounds] x0,y0,x1,y1 to limit work
   * @param {number} [alpha] 0 to 1
   */
  fill(distance, hex, bounds, alpha = 1) {
    const [r, g, b] = hexToRgb(hex);

    const x0 = Math.max(0, Math.floor(bounds ? bounds[0] : 0));
    const y0 = Math.max(0, Math.floor(bounds ? bounds[1] : 0));
    const x1 = Math.min(this.width - 1, Math.ceil(bounds ? bounds[2] : this.width));
    const y1 = Math.min(this.height - 1, Math.ceil(bounds ? bounds[3] : this.height));

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        // Sample at the pixel centre.
        const d = distance(x + 0.5, y + 0.5);
        if (d > 0.75) continue;

        const coverage = Math.min(1, Math.max(0, 0.5 - d)) * alpha;
        if (coverage <= 0) continue;

        const at = (y * this.width + x) * 4;
        const dstA = this.data[at + 3] / 255;
        const outA = coverage + dstA * (1 - coverage);
        if (outA <= 0) continue;

        this.data[at] = Math.round((r * coverage + this.data[at] * dstA * (1 - coverage)) / outA);
        this.data[at + 1] = Math.round(
          (g * coverage + this.data[at + 1] * dstA * (1 - coverage)) / outA,
        );
        this.data[at + 2] = Math.round(
          (b * coverage + this.data[at + 2] * dstA * (1 - coverage)) / outA,
        );
        this.data[at + 3] = Math.round(outA * 255);
      }
    }
  }

  /** Stroke polylines with round caps and joins. */
  stroke(polylines, width, hex, alpha = 1) {
    if (polylines.length === 0) return;
    this.fill(
      (px, py) => sdPolylines(px, py, polylines, width),
      hex,
      boundsOf(polylines, width),
      alpha,
    );
  }

  rect(x, y, w, h, hex, radius = 0, alpha = 1) {
    const cx = x + w / 2;
    const cy = y + h / 2;
    this.fill(
      (px, py) => sdRoundedBox(px, py, cx, cy, w / 2, h / 2, radius),
      hex,
      [x - 2, y - 2, x + w + 2, y + h + 2],
      alpha,
    );
  }

  circle(cx, cy, r, hex, alpha = 1) {
    this.fill(
      (px, py) => sdCircle(px, py, cx, cy, r),
      hex,
      [cx - r - 2, cy - r - 2, cx + r + 2, cy + r + 2],
      alpha,
    );
  }

  toPNG() {
    return encodePng(this.data, this.width, this.height);
  }
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

export function encodePng(rgba, width, height) {
  // Each scanline is prefixed with a filter byte. Filter 0 is "none", which
  // costs a little file size and saves a lot of code.
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
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
