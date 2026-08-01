/**
 * Where to look a Nimiq address up, and what that link honestly shows.
 *
 * ## There is no official PoS explorer, so this is a considered choice
 *
 * Nimiq does not ship a block explorer UI for Proof of Stake; the team said
 * plainly that nimiq.watch would provide an API for others to build on and no
 * interface of its own. What exists is community run, and nimiqscan is the one
 * that serves both chains from one codebase with a stable route.
 *
 * The route and the hosts are not guessed. They are read out of the explorer's
 * own router and network config:
 *
 *   /account/:address                    the route
 *   nimiqscan.com          -> Mainnet    default in its store
 *   testnet.nimiqscan.com  -> Testnet    forced by hostname
 *
 * If that ever moves, this file is the only thing to change, and a broken link
 * here is cosmetic rather than load bearing. Which is the point of the next
 * section.
 *
 * ## What the link does NOT prove
 *
 * A score is not a transaction. It is an Ed25519 signature over the date, seed,
 * stage and number, verified by the service and published on the row, and none
 * of it touches the chain. So this link cannot show anybody's score, and a row
 * for somebody who has never staked will open an account with no transactions
 * on it.
 *
 * That matters because a link labelled as proof, which opens an empty page, is
 * worse than no link: it reads as a failed verification rather than as a wallet
 * that has simply never sent anything. So the board labels this as the wallet
 * on chain, and keeps the signature as the thing that proves the score. Two
 * different claims, two different affordances, neither pretending to be the
 * other.
 */

import { onTestnet } from './network';

const MAINNET = 'https://nimiqscan.com';
const TESTNET = 'https://testnet.nimiqscan.com';

/**
 * Nimiq addresses are written in groups separated by spaces and the route
 * wants them joined by dashes. Anything that is already dashed passes through,
 * so this is safe whichever shape the wallet handed us.
 */
function forUrl(address: string): string {
  return address.trim().toUpperCase().replace(/[\s-]+/g, '-');
}

/** True when this looks like a Nimiq address rather than something else. */
export function isAddress(value: string | null | undefined): value is string {
  if (!value) return false;
  return /^NQ[0-9A-Z\s-]{34,44}$/i.test(value.trim());
}

/**
 * The explorer page for an address on the chain currently selected.
 *
 * Null rather than a guess when the input is not an address, so a caller that
 * forgets to check cannot render a link to a 404.
 */
export function accountUrl(address: string | null | undefined): string | null {
  if (!isAddress(address)) return null;
  const host = onTestnet() ? TESTNET : MAINNET;
  return `${host}/account/${forUrl(address)}`;
}

/** Named for the row, so the link can say where it is about to send somebody. */
export function explorerName(): string {
  return onTestnet() ? 'nimiqscan (testnet)' : 'nimiqscan';
}
