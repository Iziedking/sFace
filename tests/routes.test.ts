/**
 * Addresses, and the back button they exist for.
 *
 * The app was one URL. Open the campaign, open a contest, press back, and the
 * browser left the game, because as far as it was concerned you had never gone
 * anywhere. Inside a wallet's WebView that is worse than annoying: back is a
 * system gesture people use without thinking about it.
 *
 * The failure mode a table like this actually has is drift. Pushing a path when
 * a screen opens and reading a path when the browser goes back are one mapping
 * read in two directions, and when they are written separately a screen gets
 * renamed on one side and back quietly starts landing somewhere else. So every
 * test here walks an entry through both directions rather than checking either
 * on its own.
 */

import { describe, expect, it } from 'vitest';

import { isAddressless, landingFor, pathFor, type Screen } from '../src/core/routes';

/** Every screen the app can show, which the type cannot be asked for at runtime. */
const ALL: Screen[] = [
  'loading',
  'splash',
  'intro',
  'gate',
  'controls',
  'about',
  'settings',
  'profile',
  'contests',
  'contest-new',
  'contest',
  'loadout',
  'clan',
  'campaign',
  'dispatch',
  'signals',
  'brief',
  'run',
  'results',
  'board',
  'challenge',
];

/** The two that carry an id, which cannot be addressed without one. */
const WITH_ID: Screen[] = ['contest', 'challenge'];

describe('every screen is accounted for', () => {
  it('either has an address or is deliberately without one', () => {
    /*
     * The point of this one is the screen nobody thought about. Adding a screen
     * and forgetting to route it should fail here rather than be discovered by
     * a player whose back button skips it.
     */
    for (const screen of ALL) {
      const addressed = pathFor(screen, WITH_ID.includes(screen) ? 'abc' : null) !== null;
      expect(addressed || isAddressless(screen)).toBe(true);
    }
  });

  it('keeps a run and everything around it out of the history', () => {
    // You cannot restore a run from a URL: it is a live simulation, halfway
    // through a clock, with people following you. An address would promise
    // something no amount of code can deliver.
    for (const screen of ['loading', 'splash', 'intro', 'gate', 'run', 'results'] as Screen[]) {
      expect(isAddressless(screen)).toBe(true);
      expect(pathFor(screen, 'abc')).toBeNull();
    }
  });
});

describe('the two directions agree', () => {
  it('reads back every address it writes', () => {
    for (const screen of ALL) {
      const param = WITH_ID.includes(screen) ? 'a1b2c3' : null;
      const path = pathFor(screen, param);
      if (!path) continue;

      const landing = landingFor(path);
      expect(landing, `no landing for ${screen} at ${path}`).not.toBeNull();
      expect(landing!.screen).toBe(screen);
      expect(landing!.param).toBe(param);
    }
  });

  it('gives each addressed screen its own path', () => {
    // Two screens sharing a path means back lands on one of them and never the
    // other, which reads as the button being wrong rather than the table.
    const paths = ALL.map((s) => pathFor(s, 'x')).filter((p): p is string => p !== null);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe('reading an address', () => {
  it('sends the bare domain to the brief', () => {
    expect(landingFor('/')).toEqual({ screen: 'brief', param: null });
  });

  it('forgives a trailing slash and shouting', () => {
    // A URL that has been through a chat app, a QR code and a wallet's WebView
    // rarely arrives exactly as it left.
    expect(landingFor('/Campaign/')?.screen).toBe('campaign');
    expect(landingFor('/CONTESTS')?.screen).toBe('contests');
  });

  it('keeps the aliases that were already shared', () => {
    // These were the only two routed pages before any of this, and a link
    // somebody has already sent should not stop working because of a tidier
    // scheme.
    expect(landingFor('/docs')?.screen).toBe('about');
    expect(landingFor('/about')?.screen).toBe('about');
    expect(landingFor('/how-to-play')?.screen).toBe('controls');
    expect(landingFor('/play')?.screen).toBe('controls');
  });

  it('does not confuse the contest list with a contest', () => {
    expect(landingFor('/contests')?.screen).toBe('contests');
    expect(landingFor('/contests/new')?.screen).toBe('contest-new');
    expect(landingFor('/contest/abc')).toEqual({ screen: 'contest', param: 'abc' });
  });

  it('preserves the case of an id', () => {
    /*
     * Matching is done on a folded copy so the route is forgiving. The value
     * handed back has to be exactly what was in the address: an id is opaque,
     * and a lowercased one names a different contest or none at all.
     */
    expect(landingFor('/contest/AbC123')?.param).toBe('AbC123');
    expect(landingFor('/challenge/XyZ')?.param).toBe('XyZ');
  });

  it('decodes an escaped id', () => {
    expect(landingFor('/contest/a%20b')?.param).toBe('a b');
  });

  it('refuses an id-carrying path with no id', () => {
    // Better to land on the list than on a page about nothing.
    expect(landingFor('/contest')).toBeNull();
    expect(landingFor('/contest/')).toBeNull();
  });

  it('returns null for anything it does not know', () => {
    expect(landingFor('/nope')).toBeNull();
    expect(landingFor('/campaign/extra')).toBeNull();
  });
});

describe('writing an address', () => {
  it('will not name a contest it has no id for', () => {
    // A path to a page that cannot load is worse than staying put.
    expect(pathFor('contest', null)).toBeNull();
    expect(pathFor('challenge', null)).toBeNull();
  });

  it('escapes an id rather than trusting it', () => {
    expect(pathFor('contest', 'a b')).toBe('/contest/a%20b');
  });
});
