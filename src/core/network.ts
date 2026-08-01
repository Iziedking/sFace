/**
 * Which Nimiq network the app is running against.
 *
 * ## Two networks, one build
 *
 * Mainnet is the product: real NIM, real stakes, the live daily board. Testnet
 * is the same game with the money made harmless, so anyone can see the whole
 * thing end to end without spending anything or being asked to trust a stranger
 * with a wallet.
 *
 * Mainnet is the default and always will be. A player who never touches this
 * setting is on the real network, which is the only sane default for something
 * that settles bets: an app that quietly starts on a test chain will eventually
 * take somebody's real intent and put it somewhere it does not count.
 *
 * ## What testnet actually changes
 *
 * It is not a reduced version of the game. Every stage, every mechanic and every
 * screen behaves identically. What changes is the two things that cost money:
 *
 *   1. The X reads. The service will not spend a paid API call for a testnet
 *      session and serves its cached or fallback read instead. Running the whole
 *      product for an afternoon of testing should not cost a metered request per
 *      page load, and a mission built from the fallback exercises exactly the
 *      same code paths.
 *   2. The stakes. Testnet NIM has no value, so a challenge on it is a rehearsal.
 *
 * Everything else, deliberately, is the same. A test that skips the interesting
 * parts is a test that finds nothing.
 *
 * ## Why the client is allowed to declare this
 *
 * The network travels to the service as a header. That is safe in one direction
 * only, and the direction is the safe one: declaring testnet can make the
 * service spend LESS and can keep a score off the real board. It can never
 * unlock anything, raise a limit, or move real funds. Anything that does need
 * trust is settled against the chain itself, where a testnet transaction simply
 * is not a mainnet transaction and no header can pretend otherwise.
 */

export type NetworkId = 'main' | 'test';

/** The real one. Anything not explicitly test is this. */
export const DEFAULT_NETWORK: NetworkId = 'main';

const STORAGE_KEY = 'sface.network';

/**
 * Accepted spellings of the test network.
 *
 * The wallet reports its own name for the chain and the URL may carry a human's
 * guess at it, so this stays generous. Everything unrecognised falls to mainnet,
 * because guessing wrong toward the real network is a confusing session while
 * guessing wrong toward test is a bet nobody honours.
 */
function parse(value: string | null | undefined): NetworkId | null {
  if (!value) return null;
  const text = value.trim().toLowerCase();
  if (!text) return null;
  if (/^(test|testnet|albatross-test|test-albatross|dev|devnet)$/.test(text)) return 'test';
  if (/^(main|mainnet|albatross|prod|production)$/.test(text)) return 'main';
  return null;
}

let current: NetworkId | null = null;

/**
 * The network this session is on.
 *
 * Resolved once and cached, because it is read on nearly every request and a
 * value that could change between two calls in the same frame would let one
 * request go to the board and the next one not.
 */
function resolveNetwork(): NetworkId {
  if (current) return current;

  /*
   * A URL parameter wins, and it is the reason this is not only a stored
   * setting. Handing someone a link that opens the game on testnet, already
   * switched, is the difference between a judge seeing the whole product in a
   * minute and a judge hunting for a toggle.
   */
  let chosen: NetworkId | null = null;
  try {
    const params = new URLSearchParams(window.location.search);
    chosen = parse(params.get('network') ?? params.get('net'));
    /*
     * A link switches the SESSION, not the machine.
     *
     * This used to write to localStorage, which meant following one testnet link
     * once left the browser on testnet permanently: every later visit to the
     * plain URL still opened a rehearsal, with no memory of having agreed to it.
     * Opening a link is not the same as choosing a default, and only the chip is
     * treated as a deliberate choice.
     */
    if (chosen) window.sessionStorage.setItem(STORAGE_KEY, chosen);
  } catch {
    chosen = null;
  }

  if (!chosen) {
    try {
      chosen = parse(window.sessionStorage.getItem(STORAGE_KEY));
    } catch {
      chosen = null;
    }
  }

  if (!chosen) {
    try {
      chosen = parse(window.localStorage.getItem(STORAGE_KEY));
    } catch {
      // Private browsing refuses storage. Not a reason to fail to start.
      chosen = null;
    }
  }

  current = chosen ?? DEFAULT_NETWORK;
  return current;
}

/** The stored choice, ignoring practice. Used by the settings chip. */
export function chosenNetwork(): NetworkId {
  return resolveNetwork();
}

/**
 * Practice is testnet, always, whatever the chip says.
 *
 * ## Why this is an override and not a setting
 *
 * Practice is a mode, not a preference. Somebody taking a practice run has not
 * signed in and has nothing at stake, and letting that land on the mainnet board
 * would put runs there that were never played for anything.
 *
 * Writing it through setNetwork would be wrong twice over: it reloads, which
 * would throw away the practice flag that asked for it, and it would persist,
 * so leaving practice would leave you on testnet without having chosen to be.
 *
 * So it sits in front of the stored choice and disappears the moment practice
 * does. Nothing is written down, because nothing was decided.
 */
let practising = false;

export function setPractising(on: boolean): void {
  practising = on;
}

export function network(): NetworkId {
  return practising ? 'test' : resolveNetwork();
}

export function onTestnet(): boolean {
  return network() === 'test';
}

/**
 * Switch, and reload.
 *
 * The reload is not laziness. The mission, the profile, the board and the
 * challenge in flight were all fetched for the old network, and a live swap
 * would leave a screen holding a mixture of the two. Everything that could be
 * stale is thrown away at once, which is both simpler and impossible to get
 * subtly wrong.
 */
export function setNetwork(next: NetworkId): void {
  if (next === network()) return;

  /*
   * The chip is the deliberate choice, so this is the one that persists. It also
   * clears the session override, or a link-set testnet would outlive the tap
   * that asked to leave it.
   */
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do. The reload below still applies it for this session.
  }

  current = next;

  /*
   * Mark this as an in-app reload, so the app comes back where it was.
   *
   * Switching network reloads the page, and a reload boots the app from the
   * beginning: loader, opening, story. That is right for somebody arriving and
   * wrong for somebody who just tapped a toggle, who gets sent back to the front
   * of a game they were already inside. The flag below is what tells boot the
   * difference.
   */
  try {
    window.sessionStorage.setItem(RESUME_KEY, 'home');
  } catch {
    // Storage refused. The reload still works, it just replays the opening.
  }

  /*
   * Drop any network parameter, or the URL would override the choice just made.
   *
   * Rewritten in place rather than navigated to. Reloading was the old way of
   * making every cached thing agree with the new chain, and it cost a white
   * flash and a rebuild of the whole app to change one chip. The listener below
   * does the same job by refetching what actually depends on the network, and
   * the player keeps the screen they were on.
   */
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete('network');
    url.searchParams.delete('net');
    window.history.replaceState(null, '', url.toString());
  } catch {
    // A WebView that refuses history rewriting still has the right network.
  }

  for (const listener of listeners) listener(next);
}

/**
 * Told when the chain changes, so callers can refetch what depends on it.
 *
 * The mission, the profile, the boards and the contests are all per network and
 * all cached in the app, and none of them can be trusted across a switch. This
 * is how they find out without the page being thrown away and rebuilt.
 */
const listeners = new Set<(next: NetworkId) => void>();

export function onNetworkChange(handler: (next: NetworkId) => void): () => void {
  listeners.add(handler);
  return () => listeners.delete(handler);
}

const RESUME_KEY = 'sface.resume';

/**
 * Did this page load come from something the player did inside the app?
 *
 * Reading it clears it, so it only ever applies to the one load it was set for.
 * Anything that reloads as part of an in-app action should set it, and the
 * opening is skipped when it is present: the story is for somebody arriving,
 * not for somebody who flipped a switch.
 */
export function takeInAppReload(): boolean {
  try {
    const found = window.sessionStorage.getItem(RESUME_KEY);
    if (found === null) return false;
    window.sessionStorage.removeItem(RESUME_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Header name the service reads. Exported so both halves cannot disagree. */
export const NETWORK_HEADER = 'x-sface-network';

/** Headers to attach to every call to our own service. */
export function networkHeaders(): Record<string, string> {
  return { [NETWORK_HEADER]: network() };
}

/** How it is written wherever it is shown to a person. */
export function networkLabel(id: NetworkId = network()): string {
  return id === 'test' ? 'Testnet' : 'Mainnet';
}

/**
 * Where to get testnet NIM.
 *
 * Testnet is only useful for the parts of sFace that touch money, and those
 * need a balance. Without somewhere to get one, a tester can see the game on
 * testnet but cannot stake a challenge or settle one, which are precisely the
 * paths worth rehearsing.
 *
 * Nimiq runs the faucet, not us. We link to it rather than proxying it: a
 * faucet we operated would need a funded hot wallet, rate limiting and abuse
 * handling, for a service that already exists and is somebody else's job.
 */
export const TESTNET_FAUCET = 'https://faucet.pos.nimiq-testnet.com';

/** True when the player is on testnet and might need funding. */
export function needsFaucet(): boolean {
  return onTestnet();
}
