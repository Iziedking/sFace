/**
 * Which network a session and a request belong to.
 *
 * The two properties worth protecting: mainnet is what you get unless testnet is
 * asked for explicitly, and a testnet declaration can only ever reduce what the
 * service spends or keeps. Anything that inverted either would be a real
 * problem, so both are pinned here rather than left to review.
 */

import { describe, expect, it } from 'vitest';

import { networkOf, isRehearsal, NETWORK_HEADER } from '../server/network';

/** Just enough of an express Request for the header lookup under test. */
function request(headers: Record<string, string>) {
  return {
    get(name: string) {
      return headers[name.toLowerCase()];
    },
  } as unknown as Parameters<typeof networkOf>[0];
}

describe('reading the network off a request', () => {
  it('defaults to mainnet when nothing is said', () => {
    // The important direction. A mainnet request treated as testnet would keep
    // a real score off the board, which a player would report as lost work.
    expect(networkOf(request({}))).toBe('main');
    expect(isRehearsal(request({}))).toBe(false);
  });

  it('honours an explicit testnet header', () => {
    expect(networkOf(request({ [NETWORK_HEADER]: 'test' }))).toBe('test');
    expect(isRehearsal(request({ [NETWORK_HEADER]: 'test' }))).toBe(true);
  });

  it('is not fooled by case or padding', () => {
    for (const value of ['TEST', ' test ', 'Test']) {
      expect(networkOf(request({ [NETWORK_HEADER]: value }))).toBe('test');
    }
  });

  it('treats anything unrecognised as mainnet', () => {
    // Including near-misses and outright junk. Falling toward the real network
    // is the safe failure, since the cost is one API call rather than a lost
    // score or an unhonoured bet.
    for (const value of ['', 'testnet-ish', 'staging', 'main', 'nonsense', '1', 'true']) {
      expect(networkOf(request({ [NETWORK_HEADER]: value }))).toBe('main');
    }
  });

  it('agrees with the client about the header name', () => {
    // Two files declare this string. If they ever drift, every testnet session
    // silently becomes a mainnet one and starts spending money.
    expect(NETWORK_HEADER).toBe('x-sface-network');
  });
});
