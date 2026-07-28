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
 * Connect at boot and keep the result. Never throws.
 *
 * listAccounts triggers a native approval dialog the first time and caches on
 * the provider afterwards, so calling this once per session is enough.
 */
export async function connect(): Promise<WalletSession> {
  const language = hostLanguage();

  const nimiq = await getProvider();
  if (!nimiq) return { ...OFFLINE, language };

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
