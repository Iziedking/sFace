/**
 * Practice is testnet, and only for as long as it is practice.
 *
 * A practice run has nobody signed in and nothing at stake, so a score from one
 * has no business on the board people are competing on. Forcing the network is
 * also one fewer decision that only ever had a single right answer.
 *
 * The half that is easy to get wrong is the release. An override that outlives
 * the mode would leave somebody who has just signed in quietly stuck on testnet,
 * off the board they earned the right to be on, with the chip still reading
 * whatever they had chosen. That is the case these mostly cover.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * A fresh copy of the module per case.
 *
 * The resolved network is cached at module level on purpose: it is read on
 * nearly every request and a value that could change between two calls in the
 * same frame would send one request to the board and the next somewhere else.
 * Switching deliberately reloads the page, so production never sees a stale
 * cache. A test file does, and one case's storage stub would otherwise decide
 * the next case's answer.
 */
async function load(stored: string | null) {
  storedChoice(stored);
  vi.resetModules();
  return import('../src/core/network');
}

/** A browser whose stored choice is whatever the test says it is. */
function storedChoice(value: string | null) {
  const store = new Map<string, string>();
  if (value) store.set('sface.network', value);

  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    },
    sessionStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
    location: { search: '' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('while practising', () => {
  it('is testnet even though nothing was chosen', async () => {
    const net = await load(null);
    expect(net.network()).toBe('main');

    net.setPractising(true);
    expect(net.network()).toBe('test');
    expect(net.onTestnet()).toBe(true);
  });

  it('is testnet even when mainnet was chosen deliberately', async () => {
    // The override sits in front of the stored choice rather than replacing it.
    const net = await load('main');
    net.setPractising(true);

    expect(net.network()).toBe('test');
  });

  it('leaves the stored choice untouched', async () => {
    /*
     * Nothing was decided, so nothing is written down. If practice wrote to
     * storage, leaving it would strand somebody on testnet without their having
     * picked it.
     */
    const net = await load('main');
    net.setPractising(true);

    expect(net.chosenNetwork()).toBe('main');
  });
});

describe('when practice ends', () => {
  it('hands the network back to the stored choice', async () => {
    const net = await load('main');

    net.setPractising(true);
    expect(net.network()).toBe('test');

    net.setPractising(false);
    expect(net.network()).toBe('main');
  });

  it('returns to testnet if that is what they had actually picked', async () => {
    // Releasing the override is not the same as forcing mainnet.
    const net = await load('test');

    net.setPractising(true);
    expect(net.network()).toBe('test');

    net.setPractising(false);
    expect(net.network()).toBe('test');
  });
});
