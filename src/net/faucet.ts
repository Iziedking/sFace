/**
 * Testnet NIM, claimed from inside the app.
 *
 * ## Why this exists
 *
 * Settings linked out to the Nimiq faucet's own page, which currently serves a
 * twelve byte body reading "Nimiq Faucet" and nothing else. From the player's
 * side, switching to testnet and following our own link lands them on a blank
 * page with no way to get the NIM the link promised.
 *
 * The faucet's service is entirely healthy. Only its front end is missing, and
 * its API answers happily:
 *
 *   GET  /info   -> { balance, dispenseAmount, dispensesRemaining, ... }
 *   POST /tapit  -> address=NQ...  -> { success, error, msg }
 *
 * So the claim happens here instead. This is the same faucet, the same funds
 * and the same limits; the only thing being replaced is a page that is not
 * loading.
 *
 * ## Called from the browser, not through our service
 *
 * The faucet sends `Access-Control-Allow-Origin: *`, so a proxy would buy
 * nothing but a second thing to deploy and a second thing to be down. Claiming
 * works even when our own API does not, which is the correct dependency for a
 * button whose whole job is to unblock somebody.
 *
 * ## Testnet only, and that is not a soft rule
 *
 * Every function here refuses outright when the app is on mainnet. There is no
 * mainnet faucet and there is not going to be one, so a call from a mainnet
 * session is either a bug or someone poking at it, and both deserve the same
 * flat no rather than a request that quietly goes nowhere.
 */

import { onTestnet } from '../core/network';

const FAUCET = 'https://faucet.pos.nimiq-testnet.com';
const TIMEOUT_MS = 12_000;

export interface FaucetInfo {
  /** What one claim pays out, in NIM. */
  dispenseNim: number;
  /** How many claims the faucet has left before it needs topping up. */
  remaining: number;
  /** Some regions are refused outright, and it is better to say so early. */
  available: boolean;
}

export type ClaimResult =
  /**
   * `nim` is null when the faucet did not say how much it sent.
   *
   * It usually does not. The success body is `{ success: true }` and nothing
   * else, and reading a missing `amount` as zero produced "Sent 0 NIM. It lands
   * in a moment.", which is both wrong and alarming: it reads as a claim that
   * silently failed. Null means we were not told, and the caller says the
   * amount it already knows from /info rather than inventing one.
   */
  | { ok: true; nim: number | null }
  | { ok: false; reason: string };

async function ask(path: string, init?: RequestInit): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${FAUCET}${path}`, { ...init, signal: controller.signal });
    if (!response.ok) return null;
    return (await response.json()) as unknown;
  } catch {
    // Offline, blocked, or the faucet is down. The caller says so plainly.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function faucetInfo(): Promise<FaucetInfo | null> {
  if (!onTestnet()) return null;

  const raw = await ask('/info');
  if (!raw || typeof raw !== 'object') return null;

  const body = raw as Record<string, unknown>;
  const dispense = body.dispenseAmount;
  const remaining = body.dispensesRemaining;

  if (typeof dispense !== 'number' || typeof remaining !== 'number') return null;

  return {
    // The faucet quotes lunas, which is what the wallet calls the smallest
    // unit. Showing five figures where the player expects one would read as a
    // fortune rather than a top-up.
    dispenseNim: dispense / 100_000,
    remaining,
    available: body.availableInRegion !== false,
  };
}

/**
 * Ask the faucet for one dispense to this address.
 *
 * The faucet answers 200 with `success: false` for refusals rather than using a
 * status code, so a resolved fetch is not on its own a claim. Its own `msg` is
 * passed through when it has one: it knows why it said no far better than we
 * can guess, and the common reasons are worth reading rather than flattening
 * into one sentence.
 */
export async function claimFaucet(address: string): Promise<ClaimResult> {
  if (!onTestnet()) {
    return { ok: false, reason: 'The faucet only exists on testnet. Switch networks first.' };
  }

  const trimmed = address.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: 'Enter the address you want the NIM sent to.' };
  }

  const raw = await ask('/tapit', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ address: trimmed }).toString(),
  });

  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: 'Could not reach the faucet. Try again in a moment.' };
  }

  const body = raw as Record<string, unknown>;

  if (body.success === true) {
    // Taken only when it is actually there. See the note on ClaimResult.
    const amount = typeof body.amount === 'number' ? body.amount / 100_000 : null;
    return { ok: true, nim: amount };
  }

  const message = typeof body.msg === 'string' && body.msg.length > 0 ? body.msg : null;
  return { ok: false, reason: message ?? 'The faucet turned that request down.' };
}
