/**
 * Counting the wallets, for the one question a judge asks that we could not
 * answer: how many distinct Nimiq wallets actually used this.
 *
 * The number has to be defensible, which rules out the easy version. The app
 * learns an address the moment somebody connects a wallet, and counting those
 * would be larger, friendlier, and worthless: an address is a string anybody
 * can send. Only a signature ties an address to a person who was here, so only
 * signed wallets count, and the figure is smaller than the flattering one on
 * purpose.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import * as profiles from '../server/profiles';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);

const WALLET_ONE = 'NQ07 8G9F 2H1K 4L5M 6N7P 8Q9R AS1T BU2V CW3X';
const WALLET_TWO = 'NQ11 1111 2222 3333 4444 5555 6666 7777 8888';

/** A pilot who has flown, optionally with a wallet bound by a signature. */
function pilot(id: string, name: string, wallet: string | null, network = 'main') {
  profiles.record({
    id,
    name,
    network,
    avatarUrl: null,
    score: 1_000,
    rescued: 1,
    caches: 0,
    relics: 0,
    extracted: true,
    stage: 1,
  });
  if (wallet) profiles.bindAddress(id, wallet);
}

beforeEach(() => {
  profiles.restore([]);
});

describe('counting wallets', () => {
  it('counts a wallet once it has signed', () => {
    pilot(A, '@one', WALLET_ONE);
    expect(profiles.walletCount('main')).toBe(1);
  });

  it('does not count a pilot who never proved one', () => {
    // The whole point. An unsigned pilot is a player, not a wallet.
    pilot(A, '@one', null);
    expect(profiles.walletCount('main')).toBe(0);
    expect(profiles.usage('main').pilots).toBe(1);
  });

  it('counts one wallet once, however it is spelled', () => {
    /*
     * A wallet arrives space-separated from the wallet itself and dash
     * separated out of a URL. Two spellings of one address counted twice would
     * inflate the exact number this exists to state honestly.
     */
    pilot(A, '@one', WALLET_ONE);
    pilot(B, '@two', WALLET_ONE.replace(/ /g, '-').toLowerCase());

    expect(profiles.walletCount('main')).toBe(1);
    // Still two people. One wallet on two devices is one wallet and two pilots.
    expect(profiles.usage('main').pilots).toBe(2);
  });

  it('counts two wallets as two', () => {
    pilot(A, '@one', WALLET_ONE);
    pilot(B, '@two', WALLET_TWO);
    expect(profiles.walletCount('main')).toBe(2);
  });

  it('keeps testnet out of the mainnet figure', () => {
    // Test NIM is not a user. A number that mixes them is not quotable.
    pilot(A, '@one', WALLET_ONE, 'test');
    expect(profiles.walletCount('main')).toBe(0);
    expect(profiles.walletCount('test')).toBe(1);
  });

  it('ignores an account that has never flown here', () => {
    // Bound a wallet on one chain, never scored on the other.
    pilot(A, '@one', WALLET_ONE, 'test');
    profiles.ensure(B, '@two', 'main');

    expect(profiles.walletCount('main')).toBe(0);
    expect(profiles.usage('main').pilots).toBe(0);
  });
});

describe('what gets quoted', () => {
  it('reports wallets, pilots and runs together', () => {
    pilot(A, '@one', WALLET_ONE);
    pilot(B, '@two', WALLET_TWO);
    pilot(C, '@three', null);
    // A second run for the first pilot, so runs and pilots differ.
    profiles.record({
      id: A,
      name: '@one',
      network: 'main',
      avatarUrl: null,
      score: 2_000,
      rescued: 1,
      caches: 0,
      relics: 0,
      extracted: true,
      stage: 1,
    });

    const usage = profiles.usage('main');
    expect(usage.wallets).toBe(2);
    expect(usage.pilots).toBe(3);
    expect(usage.runs).toBe(4);
  });

  it('is all zeroes on a chain nobody has played', () => {
    expect(profiles.usage('main')).toEqual({ wallets: 0, pilots: 0, runs: 0 });
  });
});
