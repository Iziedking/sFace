/**
 * The two responsiveness failures that were reported from phones.
 *
 * Both were invisible on a desktop and both are the kind that come back, so
 * they get a test each even though the fix for one of them is a line of HTML.
 *
 * 1. Typing in the room. The keyboard opened, the conversation was clipped off
 *    the top of the screen, and a band of empty paper sat between it and the
 *    keyboard. The layout was the right size in the wrong place, because
 *    everything here lives in one `position: fixed` box and a fixed box resolves
 *    against the layout viewport, which a keyboard does not shrink by default.
 *
 * 2. The tour card in landscape. It sat half off the left edge on top of the HUD
 *    strip, with its title and the start of every line cut off. A media query
 *    adds no specificity, so the short-screen animation override lost the
 *    cascade to the centred one declared later in the file, and the centred
 *    keyframes end on translate(-50%, 0) with fill `both`. The transform stuck.
 *
 * The cascade one is asserted as an ORDER rather than as a string, because the
 * declaration was always present and correct. Where it sat in the file was the
 * whole bug.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import { trackViewport } from '../src/core/viewport';

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('the keyboard and the fixed app box', () => {
  it('asks the engine to resize the layout viewport, not just the visual one', () => {
    const html = read('../index.html');
    const meta = html.split('\n').find((line) => line.includes('width=device-width'));

    expect(meta).toBeDefined();
    expect(meta).toContain('interactive-widget=resizes-content');
    // The insets fix has to survive alongside it: both are in the one content
    // string, and a rewrite that drops either is a regression nobody sees until
    // it is on a phone.
    expect(meta).toContain('viewport-fit=cover');
  });

  it('gives the conversation a height that answers to the visible box', () => {
    const css = read('../src/style-room.css');
    // vh alone is the layout viewport, which Safari does not shrink for a
    // keyboard. --app-h is measured from visualViewport in core/viewport.ts.
    expect(css).toContain('var(--app-h');
  });

  it('lets the composer stay at the bottom of a short screen', () => {
    const css = read('../src/style-responsive.css');
    const short = css.indexOf('@media (max-height: 620px)');
    expect(short).toBeGreaterThan(-1);

    // The list is the part that gives up space, and it can only shrink below its
    // content with min-height: 0 on it.
    const block = css.slice(short, css.indexOf('}\n}', short));
    expect(block).toContain('.room__list');
    expect(block).toContain('flex: 1 1 auto');
    expect(block).toContain('min-height');
  });
});

describe('the tour card in landscape', () => {
  it('declares the flush arrival after the centred one it overrides', () => {
    const css = read('../src/style.css');

    const centred = css.indexOf('animation: tour-in 0.28s');
    const flush = css.indexOf('animation-name: tour-in-flush');

    expect(centred).toBeGreaterThan(-1);
    expect(flush).toBeGreaterThan(-1);
    /*
     * If this fails, the short-screen override has been moved back up beside the
     * rest of the short-screen layout, where it reads better and does nothing.
     * The centred rule wins on source order and its filled transform leaves the
     * card parked half a card-width off the left edge.
     */
    expect(flush).toBeGreaterThan(centred);
  });

  it('keeps the short-screen card anchored to the left edge with no transform', () => {
    const css = read('../src/style.css');
    const block = css.slice(css.indexOf('@media (max-height: 460px)'));

    expect(block).toContain('left: calc(env(safe-area-inset-left) + 12px)');
    expect(block).toContain('transform: none');
  });
});

/**
 * A browser with a visual viewport that can be shrunk on demand.
 *
 * Hand rolled rather than jsdom, the same way share.test.ts and the rest do it:
 * the module touches five things and a fake of five things is easier to read
 * than a document that pretends to be a phone.
 */
function browser(height: number): {
  shrink: (to: number) => void;
  focus: (element: unknown) => void;
  vars: Array<[string, string]>;
} {
  const listeners = new Map<string, Array<() => void>>();
  const frames: Array<() => void> = [];
  const vars: Array<[string, string]> = [];

  const listen = (key: string, fn: () => void): void => {
    const set = listeners.get(key) ?? [];
    set.push(fn);
    listeners.set(key, set);
  };

  const viewport = {
    height,
    addEventListener: (type: string, fn: () => void) => listen(`vv:${type}`, fn),
    removeEventListener: () => {},
  };

  const doc = {
    documentElement: { style: { setProperty: (k: string, v: string) => vars.push([k, v]) } },
    activeElement: null as unknown,
  };

  vi.stubGlobal('window', {
    visualViewport: viewport,
    addEventListener: (type: string, fn: () => void) => listen(`win:${type}`, fn),
    removeEventListener: () => {},
    dispatchEvent: () => true,
  });
  vi.stubGlobal('document', doc);
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => {
    frames.push(fn);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal('HTMLElement', Field);

  // Whatever was queued by the call under test, run now.
  const flush = (): void => frames.splice(0).forEach((fn) => fn());

  trackViewport();
  flush();

  return {
    shrink: (to: number) => {
      viewport.height = to;
      (listeners.get('vv:resize') ?? []).forEach((fn) => fn());
      flush();
    },
    focus: (element: unknown) => {
      doc.activeElement = element;
    },
    vars,
  };
}

/** Stands in for the composer. Counts being scrolled to rather than doing it. */
class Field {
  revealed = 0;
  constructor(
    readonly tagName = 'INPUT',
    readonly isContentEditable = false,
  ) {}

  scrollIntoView(): void {
    this.revealed += 1;
  }
}

describe('keeping the field in view when the keyboard opens', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('corrects the app box to the visible height', () => {
    const page = browser(800);
    page.shrink(420);

    expect(page.vars).toContainEqual(['--app-h', '800px']);
    expect(page.vars).toContainEqual(['--app-h', '420px']);
  });

  it('reveals the field being typed into', () => {
    const page = browser(800);
    const field = new Field();
    page.focus(field);

    page.shrink(420);

    expect(field.revealed).toBe(1);
  });

  it('leaves the page alone when the box grows back', () => {
    const page = browser(420);
    const field = new Field();
    page.focus(field);

    // The keyboard going away, which must not yank the conversation anywhere.
    page.shrink(800);

    expect(field.revealed).toBe(0);
  });

  it('does nothing when nothing is being typed into', () => {
    const page = browser(800);
    // The box also shrinks when the browser chrome slides in, mid-run, with no
    // field on screen at all. Reaching for activeElement there has to be safe.
    expect(() => page.shrink(420)).not.toThrow();
  });

  it('ignores a focused thing that is not a field', () => {
    const page = browser(800);
    const button = new Field('BUTTON');
    page.focus(button);

    page.shrink(420);

    expect(button.revealed).toBe(0);
  });
});
