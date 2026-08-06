/**
 * Everything that touches the Nimiq Pay provider enters through this file.
 *
 * Verified against the installed @nimiq/mini-app-sdk@0.1.0 by reading
 * node_modules/@nimiq/mini-app-sdk/dist/provider.d.ts, not from memory and not
 * from the docs page. If you bump the SDK, re-read that file before trusting
 * anything here. The surface is small and it moves.
 *
 * Two rules for this file:
 *
 * 1. The game stays playable when the wallet is not there. Every call degrades
 *    to solo play. It never blanks the screen. That matters because the app
 *    runs in a plain browser during development and a judge may open the URL
 *    outside Nimiq Pay.
 *
 * 2. Provider errors RESOLVE, they do not throw. A call that fails comes back
 *    as { error: { type, message } }. A bare try/catch reads that as success,
 *    which on a payment means reporting a transfer that never happened. Use
 *    isProviderError on every single result.
 */

import { init, getHostLanguage, requestDeviceIdentifier } from '@nimiq/mini-app-sdk';
import type { NimiqProvider, ErrorResponse } from '@nimiq/mini-app-sdk';

/** 1 NIM = 100000 Lunas. Every value the provider takes is in Lunas. */
export const LUNAS_PER_NIM = 1e5;

/** Convert a NIM figure to the integer Lunas the provider expects. */
export function nimToLunas(nim: number): number {
  return Math.round(nim * LUNAS_PER_NIM);
}

/** Convert Lunas back to NIM for display. */
export function lunasToNim(lunas: number): number {
  return lunas / LUNAS_PER_NIM;
}

/**
 * The provider signals failure by resolving with an error envelope rather than
 * rejecting. This is the discriminator, and it is the reason nothing in this
 * codebase trusts a resolved provider promise on its own.
 */
export function isProviderError<T>(
  result: T | ErrorResponse,
): result is ErrorResponse {
  return typeof result === 'object' && result !== null && 'error' in result;
}

export interface WalletSession {
  /** True when we are running inside Nimiq Pay with a live provider. */
  available: boolean;
  /** First Nimiq address, once the user has approved account access. */
  address: string | null;
  /** Pseudonymous per-device id, 64-char hex, scoped to our origin. */
  deviceId: string | null;
  /** ISO 639-1 code from Nimiq Pay, falling back to the browser. */
  language: string;
  /**
   * Whatever network the host wallet is on, verbatim.
   *
   * A mini app cannot choose this. Nimiq Pay decides, and we report it. That
   * matters because a stake shown as "5 NIM" when the wallet is on testnet is
   * a number that means something different from what the player reads, and
   * the fix is to say which network it is rather than to hide it.
   */
  network: string | null;
}

const OFFLINE: Omit<WalletSession, 'language'> = {
  available: false,
  address: null,
  deviceId: null,
  network: null,
};

/** True when the host wallet is on anything other than the main network. */
/** Records that a wallet host is present. Read by core/fullscreen.ts. */
function markHost(): void {
  (window as unknown as { __sfaceInHost?: boolean }).__sfaceInHost = true;
}

export function isTestnet(network: string | null): boolean {
  if (!network) return false;
  return /test|dev|albatross-test/i.test(network);
}

/** Held so the rest of the app never calls init() twice. */
let provider: NimiqProvider | null = null;

/**
 * Nimiq Pay seeds the language before the page script runs, so this is safe to
 * read during module init. Outside Nimiq Pay we fall back to the browser.
 */
export function hostLanguage(): string {
  return getHostLanguage() ?? navigator.language.split('-')[0] ?? 'en';
}

/**
 * Get the provider, or null when we are not inside Nimiq Pay.
 *
 * init() polls for window.nimiq and rejects when it never arrives. The default
 * timeout is 10 seconds, which is a long time to stare at a boot screen, so we
 * cut it to 2.5. In a plain browser the provider is never coming and we want
 * the player in the game, not waiting on a wallet they do not have.
 */
export async function getProvider(): Promise<NimiqProvider | null> {
  if (provider) return provider;
  try {
    provider = await init({ timeout: 2500 });
    return provider;
  } catch {
    return null;
  }
}

/**
 * Notice the wallet without asking the player for anything.
 *
 * ## Why this is separate from connecting
 *
 * The SDK draws a line and we were stepping over it. `init` opens the bridge to
 * the host and prompts nobody. `listAccounts` is what raises the native approval
 * dialog. The provider also carries `connect`, `disconnect` and a `connected`
 * getter, which is only a sensible shape if connecting is a deliberate act.
 *
 * We used to call `listAccounts` during boot, so opening the game inside Nimiq
 * Pay threw an account approval dialog at somebody who had not yet asked for
 * anything. Reported as the wallet connecting by itself, which is exactly what
 * it was.
 *
 * This reads only what the host volunteers: that it is there, its language, and
 * its network. All three are needed to draw the first screen correctly and none
 * of them costs the player a decision.
 */
export async function probe(): Promise<WalletSession> {
  const language = hostLanguage();

  const nimiq = await getProvider();
  if (!nimiq) return { ...OFFLINE, language };

  markHost();

  let network: string | null = null;
  try {
    network = nimiq.getNetwork();
  } catch {
    network = null;
  }

  return { ...OFFLINE, available: true, language, network };
}

/**
 * Ask for account access. This is the one that prompts.
 *
 * Called when something genuinely needs an address: signing a score, staking a
 * challenge, settling one, or the player pressing Connect. The provider caches
 * the approval, so a second call resolves without another dialog.
 */
export async function connect(): Promise<WalletSession> {
  const language = hostLanguage();

  const nimiq = await getProvider();
  if (!nimiq) return { ...OFFLINE, language };

  /*
   * Remember that a host answered, for code that cannot ask asynchronously.
   *
   * The fullscreen control has to decide whether to exist while it is being
   * drawn, and the wallet draws its own header that no web API can remove, so
   * offering fullscreen there is offering a button that cannot work. A flag on
   * window is the cheapest way to let a synchronous caller know.
   */
  markHost();

  // Read once at connect. It cannot change without the host restarting.
  let network: string | null = null;
  try {
    network = nimiq.getNetwork();
  } catch {
    network = null;
  }

  try {
    const accounts = await nimiq.listAccounts();
    if (isProviderError(accounts)) {
      // The provider is there, the user just declined. Solo play still works.
      return { ...OFFLINE, available: true, language, network };
    }

    return {
      available: true,
      address: accounts[0] ?? null,
      deviceId: null,
      language,
      network,
    };
  } catch {
    return { ...OFFLINE, available: true, language, network };
  }
}

/**
 * Ask for the device identifier that keys the daily leaderboard.
 *
 * This identifies the device, not the user, and it cannot be correlated across
 * mini apps. The first call per origin prompts with the reason we pass, later
 * calls resolve silently. Returns null when the user declines, which means the
 * player scores locally and simply does not appear on the board.
 */
export async function askDeviceId(): Promise<string | null> {
  try {
    return await requestDeviceIdentifier({
      reason: 'Rank your run on the daily leaderboard',
    });
  } catch {
    return null;
  }
}

/**
 * Ask the wallet to sign a score claim.
 *
 * The one place this codebase asks the wallet to prove identity rather than to
 * move money. What comes back is a public key and a signature; the address is
 * never sent, because the service derives it from the key and a client-supplied
 * address would be a claim about the signature rather than its author.
 *
 * Returns null on every failure, including the user declining. Refusing to sign
 * must cost a player nothing: the run still posts, it simply posts unsigned,
 * which is exactly what a plain browser has always done.
 */
export async function signClaim(message: string): Promise<SignedClaim | null> {
  const nimiq = await getProvider();
  if (!nimiq) return null;

  try {
    const result = await nimiq.sign(message);
    // The provider resolves with an error envelope rather than throwing, so a
    // resolved promise is not on its own a success. See isProviderError.
    if (isProviderError(result)) return null;

    const { publicKey, signature } = result;
    if (typeof publicKey !== 'string' || typeof signature !== 'string') return null;

    return { publicKey, signature };
  } catch {
    return null;
  }
}

export interface SignedClaim {
  publicKey: string;
  signature: string;
}

/**
 * Where anchored runs are sent. Empty turns the whole feature off.
 *
 * A build without it simply never offers to anchor, which is the right
 * behaviour for a fork or a local checkout: nobody should be able to send NIM
 * to an address the person running the app did not choose.
 */
export const ANCHOR_ADDRESS: string = import.meta.env.VITE_ANCHOR_ADDRESS ?? '';

/**
 * The smallest amount that can be sent, in lunas. 1 NIM is 100,000 of them.
 *
 * The transaction exists to carry its data, not to move money, so it moves the
 * least the chain will accept. What the player actually pays is the network
 * fee on top.
 */
const ANCHOR_VALUE = 1;

/**
 * Put a run on the chain.
 *
 * ## Why this returns the whole transaction
 *
 * The obvious thing to hand back is the hash, and the obvious thing is wrong:
 * a hash is a string, so a service that accepted one would be publishing a
 * claim dressed as a receipt. The provider returns the serialized transaction,
 * which the service can take apart and check field by field before computing
 * the hash itself. See server/anchor.ts.
 *
 * Returns null on every failure, including the player declining in the wallet.
 * Refusing to anchor must cost nothing: the run is already on the board, and
 * anchoring only ever adds a permanent record to a row that already exists.
 */
export async function anchorRun(data: string): Promise<string | null> {
  if (!ANCHOR_ADDRESS) return null;

  const nimiq = await getProvider();
  if (!nimiq) return null;

  try {
    const result = await nimiq.sendBasicTransactionWithData({
      recipient: ANCHOR_ADDRESS,
      value: ANCHOR_VALUE,
      data,
    });

    // The provider resolves with an error envelope rather than throwing, so a
    // resolved promise is not on its own a success. See isProviderError.
    if (isProviderError(result)) return null;
    return typeof result === 'string' && result.length > 0 ? result : null;
  } catch {
    return null;
  }
}

/** True when the wallet has caught up enough to be asked about money. */
export async function inConsensus(): Promise<boolean> {
  const nimiq = await getProvider();
  if (!nimiq) return false;
  try {
    return await nimiq.isConsensusEstablished();
  } catch {
    return false;
  }
}

/**
 * What is actually in the connected wallet, in NIM.
 *
 * ## There is no balance method, so this goes through the RPC
 *
 * The Mini App SDK at 0.1.0 has `listAccounts`, `sign`, the send helpers and
 * `isConsensusEstablished`, and nothing that returns a balance. What it does
 * expose is `getRPC()`, a handle on the node the host is already talking to, so
 * the balance is one standard Albatross call away rather than a second network
 * dependency of our own.
 *
 * `getRPC()` returns undefined when the host has not configured one, which is
 * why every failure here funnels to null instead of zero. Those are completely
 * different statements: zero means the wallet is empty and null means nobody
 * asked. Printing "0 NIM" at somebody who has funds, because we could not
 * reach a node, is the kind of wrong number that makes a player distrust every
 * other figure on the screen.
 *
 * ## Not verified, and it does not need to be
 *
 * This is a display. Nothing is authorised against it: a stake is approved in
 * the wallet's own dialog, against its own idea of the balance, so a stale or
 * missing figure here cannot let anybody spend what they do not have.
 */
export async function balanceNim(address: string): Promise<number | null> {
  const nimiq = await getProvider();
  if (!nimiq) return null;

  try {
    const rpc = nimiq.getRPC();
    if (!rpc) return null;

    const answer = await rpc.call<{ data?: { balance?: number } } | { balance?: number }>({
      jsonrpc: '2.0',
      method: 'getAccountByAddress',
      params: [address],
    });

    /*
     * Albatross wraps results in `{ data }`, but the shape has moved between
     * node versions and this is a display, so both are accepted rather than
     * pinning one and returning null on the other.
     */
    const raw =
      answer && typeof answer === 'object' && 'data' in answer
        ? (answer as { data?: { balance?: number } }).data?.balance
        : (answer as { balance?: number } | null)?.balance;

    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return null;
    return lunasToNim(raw);
  } catch {
    // Unreachable node, a method this host does not serve, or a shape we did
    // not expect. All of them mean the same thing to the player: not known.
    return null;
  }
}
