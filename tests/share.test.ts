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
}

/**
 * A browser with the pointer and the share API dialled independently.
 *
 * Those two being independent is the entire point. Every real failure came from
 * code that assumed the API existing meant the sheet was the right destination.
 */
function browser(options: { coarse: boolean; hasShare: boolean }): Fake {
  const fake: Fake = { opened: [], sheets: [] };

  const win = {
    open: (url: string) => {
      fake.opened.push(String(url));
      return { focus() {}, closed: false };
    },
    matchMedia: () => ({ matches: options.coarse }),
    location: { href: '' },
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
    const fake: Fake = { opened: [], sheets: [] };
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
