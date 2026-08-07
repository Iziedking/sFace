/**
 * Every screen has an address, so the back button does what it says.
 *
 * ## Why this exists
 *
 * The app was one URL. Open the campaign, open a contest, open your profile,
 * press back, and the browser leaves the game entirely, because as far as it is
 * concerned you never went anywhere. Inside a wallet's WebView that is worse
 * than annoying: back is a system gesture people use without thinking, and it
 * dropped them out of a run they were three minutes into.
 *
 * ## Why the table is here and not in main
 *
 * Two directions have to agree. Pushing a path when a screen opens and reading
 * a path when the browser goes back are the same mapping read forwards and
 * backwards, and two copies of it drift: a screen gets renamed, one side is
 * updated, and back quietly lands somewhere else. One table, both directions,
 * and a test that walks every entry through both.
 *
 * ## What deliberately has no address
 *
 * A run, and everything that leads into one. You cannot restore a run from a
 * URL: it is a live simulation seeded by a mission, halfway through a clock,
 * with people following you. An address that pretended otherwise would promise
 * a thing no amount of code can deliver. The loading screen, the opening titles
 * and the sign-in door are the same case for a simpler reason: they are moments
 * rather than places, and a history entry for each one means pressing back four
 * times to leave.
 */

/** Every screen the app can show. Kept in step with main.ts. */
export type Screen =
  | 'loading'
  | 'splash'
  | 'intro'
  | 'gate'
  | 'controls'
  | 'about'
  | 'settings'
  | 'profile'
  | 'contests'
  | 'contest-new'
  | 'contest'
  | 'loadout'
  | 'clan'
  | 'campaign'
  | 'dispatch'
  | 'signals'
  | 'chat'
  | 'brief'
  | 'run'
  | 'results'
  | 'board'
  | 'challenge';

export interface Landing {
  screen: Screen;
  /** The contest or challenge named by the path, when there is one. */
  param: string | null;
}

/**
 * Screens that own a fixed path.
 *
 * The home screen is the mission brief rather than the sign-in door, because
 * the brief is where somebody who is already playing considers themselves to
 * be, and it is what the top-left of the chrome goes to.
 */
const FIXED: ReadonlyArray<readonly [Screen, string]> = [
  ['brief', '/'],
  ['campaign', '/campaign'],
  ['board', '/board'],
  ['contests', '/contests'],
  ['contest-new', '/contests/new'],
  ['profile', '/profile'],
  ['clan', '/clan'],
  ['dispatch', '/dispatch'],
  ['signals', '/signals'],
  ['chat', '/room'],
  ['loadout', '/loadout'],
  ['settings', '/settings'],
  /*
   * These two keep the addresses they already had.
   *
   * They were the only routed pages before this, they are linked from outside,
   * and a shared link that stops working is a worse outcome than a tidier
   * scheme. /about and /play still answer as aliases below.
   */
  ['about', '/docs'],
  ['controls', '/how-to-play'],
];

/** Screens whose path carries an id. */
const WITH_ID: ReadonlyArray<readonly [Screen, string]> = [
  ['contest', '/contest'],
  ['challenge', '/challenge'],
];

/**
 * Paths that are not the canonical one for their screen but must still work.
 *
 * Read-only: nothing ever navigates TO one of these, so they never appear in
 * the address bar after the first load.
 */
const ALIASES: ReadonlyArray<readonly [string, Screen]> = [
  ['/about', 'about'],
  ['/play', 'controls'],
  ['/controls', 'controls'],
  ['/home', 'brief'],
];

/**
 * Screens with no address at all.
 *
 * Asked as a question rather than assumed from a missing entry, so adding a
 * screen and forgetting to route it is a test failure rather than a silent
 * hole. See the note at the top for why each of these is deliberate.
 */
const ADDRESSLESS: ReadonlySet<Screen> = new Set<Screen>([
  'loading',
  'splash',
  'intro',
  'gate',
  'run',
  /*
   * Results are a report on a run that has already finished.
   *
   * Reachable by pressing back onto it, the page would be a table about a run
   * the app no longer has, so it is a place you leave rather than one you
   * return to.
   */
  'results',
]);

export function isAddressless(screen: Screen): boolean {
  return ADDRESSLESS.has(screen);
}

/**
 * The address for a screen, or null when it has none.
 *
 * `param` is required for the two screens that take one; without it there is
 * nothing to name and the screen falls back to having no address rather than
 * pushing a path that leads nowhere.
 */
export function pathFor(screen: Screen, param: string | null = null): string | null {
  if (ADDRESSLESS.has(screen)) return null;

  const fixed = FIXED.find(([s]) => s === screen);
  if (fixed) return fixed[1];

  const withId = WITH_ID.find(([s]) => s === screen);
  if (withId && param) return `${withId[1]}/${encodeURIComponent(param)}`;

  return null;
}

/**
 * The screen an address names, or null when nothing does.
 *
 * Trailing slashes and case are forgiven, because a URL that has been through a
 * chat app, a QR code and a wallet's WebView rarely arrives exactly as it left.
 */
export function landingFor(rawPath: string): Landing | null {
  const path = rawPath.replace(/\/+$/, '').toLowerCase() || '/';

  const fixed = FIXED.find(([, p]) => p === path);
  if (fixed) return { screen: fixed[0], param: null };

  const alias = ALIASES.find(([p]) => p === path);
  if (alias) return { screen: alias[1], param: null };

  for (const [screen, prefix] of WITH_ID) {
    if (!path.startsWith(`${prefix}/`)) continue;

    /*
     * Off the raw path, not the lowercased one.
     *
     * Ids are opaque and case matters in them. Matching is done on a folded
     * copy so the route is forgiving; the value handed back has to be exactly
     * what was in the address or it names a different contest.
     */
    const id = decodeURIComponent(rawPath.replace(/\/+$/, '').slice(prefix.length + 1));
    if (id) return { screen, param: id };
  }

  return null;
}
