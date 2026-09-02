/**
 * The client modules have to survive being imported without a browser.
 *
 * ## Why this exists
 *
 * `deeplink.ts` read `window.location.origin` at module scope, so importing it
 * at all threw outside a browser. Anything on the Node side that pulled in a
 * screen pulled in that ReferenceError with it, and the first test to import a
 * screen found it.
 *
 * It hid for a while, and the way it hid is the point. The line was
 * `import.meta.env.VITE_APP_ORIGIN ?? window.location.origin`, so the fallback
 * only ran when that variable was unset. A local `.env` sets it. The suite
 * passed on the machine that had the file and failed on CI, which does not:
 * the environment without the secret is the one telling the truth.
 *
 * ## What this actually checks
 *
 * That importing does not throw. Not that every function works headless, which
 * is not true and does not need to be: a screen may reach for a `document` when
 * it renders. What must never happen is a module deciding it needs a browser
 * the moment it is loaded, because that failure lands on whoever imports it
 * next rather than on whoever wrote it.
 */

import { describe, expect, it } from 'vitest';

/**
 * Modules a Node-side test could reasonably reach, directly or by import.
 *
 * The UI screens are here because the server shares rule modules with them and
 * a test of one can easily pull in the other. The nimiq wrappers are here
 * because they are the ones most tempted to touch a global.
 */
const MODULES = [
  '../src/ui/screens',
  '../src/ui/dom',
  '../src/ui/contest',
  '../src/ui/contest-new',
  '../src/ui/contests',
  '../src/ui/profile',
  '../src/ui/settings',
  '../src/nimiq/deeplink',
  '../src/core/routes',
  '../src/core/gatecard',
  '../src/data/contests',
  '../src/data/campaign',
];

describe('importing a client module without a browser', () => {
  for (const path of MODULES) {
    it(`does not throw for ${path.replace('../src/', '')}`, async () => {
      await expect(import(path)).resolves.toBeDefined();
    }, 15_000);
  }
});

describe('the link builders specifically', () => {
  it('build a link with no window to be relative to', async () => {
    /*
     * The exact shape that broke. With no window and no configured origin there
     * is nothing to be relative to, so the path is empty rather than guessed:
     * a link built from a guess is worse than one that is obviously unfinished.
     */
    const { challengeDeeplink, shareableLink } = await import('../src/nimiq/deeplink');

    expect(() => challengeDeeplink('abc')).not.toThrow();
    expect(() => shareableLink('c=abc')).not.toThrow();
    expect(challengeDeeplink('abc')).toContain('nimiqpay://miniapp');
  });
});
