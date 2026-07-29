/**
 * A QR code, drawn as one SVG path.
 *
 * ## Why SVG rather than a canvas or an image
 *
 * A QR is a grid of squares, which is exactly what vector graphics are for. As
 * SVG it is crisp at every size and on every pixel ratio, it scales with the
 * layout instead of being sampled, it costs no canvas and no data URL, and it
 * inherits the page's ink colour so it matches the rest of the app rather than
 * being a black rectangle dropped onto cream paper.
 *
 * ## Why one path and not a thousand rects
 *
 * A 33 by 33 code is over a thousand modules, and a thousand DOM nodes for a
 * decoration inside a panel that is usually hidden is a real cost on a phone.
 * Every dark module becomes four commands in a single path instead, so the
 * whole code is one element.
 *
 * The quiet zone is not optional. Scanners need clear space around a code to
 * find it, and a QR flush against a border is a QR that often will not read.
 */

import qrcode from 'qrcode-generator';

/** Modules of clear space on every side. Four is the spec's minimum. */
const QUIET = 4;

export function qrSvg(text: string): SVGSVGElement {
  /*
   * Type 0 means "pick the smallest version that fits". Error correction M
   * rather than L: these get scanned off a laptop screen at an angle, and the
   * extra redundancy costs a slightly denser grid for a much better read rate.
   */
  const code = qrcode(0, 'M');
  code.addData(text);
  code.make();

  const count = code.getModuleCount();
  const size = count + QUIET * 2;

  let path = '';
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (!code.isDark(row, col)) continue;
      path += `M${col + QUIET} ${row + QUIET}h1v1h-1z`;
    }
  }

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  // Decorative here: the link is already a button next to it, so a screen
  // reader gains nothing from a thousand-module grid it cannot scan.
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'QR code to open sFace in Nimiq Pay');
  svg.setAttribute('shape-rendering', 'crispEdges');

  // The quiet zone has to be light even on a dark surface, or the code is
  // unreadable. Painted rather than inherited for that reason.
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bg.setAttribute('width', String(size));
  bg.setAttribute('height', String(size));
  bg.setAttribute('fill', '#f6f0e4');
  svg.append(bg);

  const dark = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  dark.setAttribute('d', path);
  dark.setAttribute('fill', '#14110e');
  svg.append(dark);

  return svg;
}
