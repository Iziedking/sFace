/**
 * Which network a request belongs to, and what that costs us.
 *
 * ## The problem this solves
 *
 * Every read of X is metered. A single afternoon of testing, with the page
 * reloaded a few dozen times and a handful of people poking at CT Signals, can
 * burn through a meaningful slice of a month's quota without producing a single
 * piece of information anybody needed. The game is the same either way, so
 * paying for the live read during a rehearsal is money spent on nothing.
 *
 * So a testnet session never triggers a paid call. It is served whatever the
 * cache already holds, and the fallback when the cache is empty. The mission it
 * gets has the same shape, the same fields and the same validation, so it
 * exercises the same code and is a genuine test rather than a stub.
 *
 * ## Why trusting the client here is safe
 *
 * The network arrives as a header, which means a caller chooses it. That is
 * acceptable because of what it can and cannot do.
 *
 * It can: make us spend less, and keep a score off the real board.
 *
 * It cannot: unlock a paid feature, raise a rate limit, mint anything, or move
 * funds. Everything with money in it settles against the chain, and a testnet
 * transaction is not a mainnet transaction no matter what a header says.
 *
 * The worst a dishonest caller achieves is a worse experience for themselves and
 * a smaller bill for us. That is the right shape for a trust boundary: the lie
 * is not worth telling.
 */

import type { Request } from 'express';

export type NetworkId = 'main' | 'test';

/** Must match the client's constant in src/core/network.ts. */
export const NETWORK_HEADER = 'x-sface-network';

/**
 * Read the network off a request.
 *
 * Anything absent or unrecognised is mainnet. Defaulting toward the real network
 * is the correct failure direction: a mainnet request served as testnet would
 * silently keep a real score off the board, which is a bug a player would report
 * as lost work, while the reverse merely costs us one API call.
 */
export function networkOf(req: Request): NetworkId {
  const raw = req.get(NETWORK_HEADER);
  if (typeof raw !== 'string') return 'main';
  return raw.trim().toLowerCase() === 'test' ? 'test' : 'main';
}

/** True when this request must not trigger a metered call. */
export function isRehearsal(req: Request): boolean {
  return networkOf(req) === 'test';
}
