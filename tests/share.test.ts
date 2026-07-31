/**
 * The share buttons, which have now failed four separate times.
 *
 * Every failure was the same shape and every fix covered one of the two
 * functions that share it. The trap is that `navigator.share` EXISTS on desktop
 * Chrome, so testing for the API and handing off to the OS looks correct, does
 * not throw, and produces a button that silently does nothing: the system sheet
 * simply never appears. There is no error to find and nothing in the console.
 *
 * shareRun learned this. shareLink did not, so Invite on X was dead on desktop
 * while Share this run worked, in the same build.
 *
 * These run both functions through the same table. A fix that only reaches one
 * of them fails here rather than in somebody's hands.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { shareLink, shareRun, xIntent, type CardData } from '../src/ui/share';

const TEXT = 'Clan MIA has pulled 377,043 Face out of the Collapse.';
const LINK = 'https://sface.site/?clan=MIA';

const CARD: CardData = {
  ticker: 'M',
  changePct: -14.7,
  live: true,
  date: '2026-07-31',
  score: 4200,
  facesExtracted: 3,
  facesTotal: 5,
  attackersCleared: 7,
  survived: true,
  rank: null,
  saved: [],
  headline: null,
  handle: null,
};

interface Fake {
  opened: string[];
  sheets: unknown[];
  /** Where the CURRENT page was sent, if anywhere. Empty means it stayed put. */
  navigated: string;
  /** Whether the new tab had its opener severed. */
  severed: boolean;
}

/**
 * A browser with the pointer and the share API dialled independently.
 *
 * Those two being independent is the entire point. Every real failure came from
 * code that assumed the API existing meant the sheet was the right destination.
 */
function browser(options: {
  coarse: boolean;
  hasShare: boolean;
  /** Simulate a popup blocker, which is the only thing that should fall back. */
  blocked?: boolean;
}): Fake {
  const fake: Fake = { opened: [], sheets: [], navigated: '', severed: false };

  const win = {
    open: (url: string) => {
      fake.opened.push(String(url));
      if (options.blocked) return null;
      const tab = { focus() {}, closed: false, opener: {} as unknown };
      Object.defineProperty(tab, 'opener', {
        set: (value: unknown) => {
          if (value === null) fake.severed = true;
        },
        get: () => null,
        configurable: true,
      });
      return tab;
    },
    matchMedia: () => ({ matches: options.coarse }),
    location: {
      get href() {
        return fake.navigated;
      },
      set href(value: string) {
        fake.navigated = value;
      },
    },
  };

  const nav: Record<string, unknown> = {
    userActivation: { isActive: true },
    canShare: () => false,
  };
  if (options.hasShare) {
    nav.share = (payload: unknown) => {
      fake.sheets.push(payload);
      return Promise.resolve();
    };
  }

  vi.stubGlobal('window', win);
  vi.stubGlobal('navigator', nav);
  return fake;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a desktop never gets handed the OS share sheet', () => {
  /*
   * The case that broke four times. A fine pointer with the API present is
   * precisely desktop Chrome, and it must open the composer.
   */
  it('opens the composer from a clan invite', async () => {
    const fake = browser({ coarse: false, hasShare: true });

    await shareLink(TEXT, LINK);

    expect(fake.sheets).toHaveLength(0);
    expect(fake.opened).toEqual([xIntent(TEXT, LINK)]);
  });

  it('opens the composer from a run share', async () => {
    const fake = browser({ coarse: false, hasShare: true });

    await shareRun(CARD, null, LINK);

    expect(fake.sheets).toHaveLength(0);
    expect(fake.opened).toHaveLength(1);
    expect(fake.opened[0]).toContain('intent/tweet');
  });
});

describe('a phone gets the sheet, because that is what people use there', () => {
  it('hands a clan invite to the sheet', async () => {
    const fake = browser({ coarse: true, hasShare: true });

    await shareLink(TEXT, LINK);

    expect(fake.opened).toHaveLength(0);
    expect(fake.sheets).toEqual([{ text: TEXT, url: LINK }]);
  });

  it('hands a run to the sheet', async () => {
    const fake = browser({ coarse: true, hasShare: true });

    await shareRun(CARD, null, LINK);

    expect(fake.opened).toHaveLength(0);
    expect(fake.sheets).toHaveLength(1);
  });
});

describe('no share API at all', () => {
  // An older browser, or a WebView with it switched off. Both paths still have
  // to land somewhere rather than doing nothing.
  it('falls back to the composer for a clan invite', async () => {
    const fake = browser({ coarse: true, hasShare: false });

    await shareLink(TEXT, LINK);

    expect(fake.opened).toEqual([xIntent(TEXT, LINK)]);
  });

  it('falls back to the composer for a run', async () => {
    const fake = browser({ coarse: true, hasShare: false });

    await shareRun(CARD, null, LINK);

    expect(fake.opened).toHaveLength(1);
  });
});

describe('a dismissed sheet is not a failure', () => {
  it('does not then open a window behind the person who cancelled', async () => {
    // They said no. Opening the composer anyway is arguing with them.
    const fake: Fake = { opened: [], sheets: [], navigated: '', severed: false };
    vi.stubGlobal('window', {
      open: (url: string) => {
        fake.opened.push(String(url));
        return { focus() {}, closed: false };
      },
      matchMedia: () => ({ matches: true }),
      location: { href: '' },
    });
    vi.stubGlobal('navigator', {
      userActivation: { isActive: true },
      canShare: () => false,
      share: () => Promise.reject(new DOMException('cancelled', 'AbortError')),
    });

    await shareLink(TEXT, LINK);

    expect(fake.opened).toHaveLength(0);
  });
});

/**
 * One share, one destination.
 *
 * openIntent opened the tab with 'noopener' and then treated a null return as a
 * blocked popup, falling back to navigating the current page. But noopener makes
 * window.open return null even on success, by specification, so the fallback
 * fired every time: a composer opened in a new tab AND the game page took itself
 * to X as well. Two tabs, and the run gone with the page that held it.
 *
 * The old stub returned a truthy window, which is why the tests above never
 * caught it. These pin the count.
 */
describe('sharing sends you to exactly one place', () => {
  it('opens a tab and leaves the game where it was', () => {
    const fake = browser({ coarse: false, hasShare: true });

    void shareLink(TEXT, LINK);

    expect(fake.opened).toHaveLength(1);
    // The one that matters. A non-empty value here is the game page navigating
    // itself to X on top of the tab it just opened.
    expect(fake.navigated).toBe('');
  });

  it('severs the new tab from the page that opened it', () => {
    // The reason 'noopener' was there. Reverse tabnabbing is closed either way,
    // but only one of the two ways leaves a usable return value.
    const fake = browser({ coarse: false, hasShare: true });

    void shareLink(TEXT, LINK);

    expect(fake.severed).toBe(true);
  });

  it('falls back to this tab only when the popup was genuinely blocked', () => {
    const fake = browser({ coarse: false, hasShare: true, blocked: true });

    void shareLink(TEXT, LINK);

    expect(fake.navigated).toBe(xIntent(TEXT, LINK));
  });

  it('holds for the run share too, which is the other half of the pair', () => {
    const fake = browser({ coarse: false, hasShare: true });

    void shareRun(CARD, null, LINK);

    expect(fake.opened).toHaveLength(1);
    expect(fake.navigated).toBe('');
  });
});
