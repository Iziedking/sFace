/**
 * The link on a board row has to go where it says.
 *
 * A dead explorer link on the row that claims a score is checkable is worse
 * than no link, because it reads as a failed verification rather than as a bad
 * URL. The route and hosts here were read out of the explorer's own router and
 * network store rather than guessed:
 *
 *   /account/:address                    the route
 *   nimiqscan.com          -> Mainnet
 *   testnet.nimiqscan.com  -> Testnet
 *
 * So these pin the two things that would break it silently: the address shape
 * the route expects, and following the network switch.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

/** A real, well known address, in the spaced form a wallet hands over. */
const SPACED = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000';
const DASHED = 'NQ07-0000-0000-0000-0000-0000-0000-0000-0000';

/**
 * A fresh copy of both modules, on the network the case asks for.
 *
 * The resolved network is cached at module level, and explorer.ts reads it, so
 * the two have to be reloaded together. `setPractising` rather than
 * `setNetwork`: switching deliberately reloads the page, which a test cannot
 * do, and practice mode is the supported way to force testnet in process.
 */
async function load(testnet: boolean) {
  vi.stubGlobal('window', {
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    location: { search: '' },
  });
  vi.resetModules();

  const net = await import('../src/core/network');
  if (testnet) net.setPractising(true);
  return import('../src/core/explorer');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('what counts as an address', () => {
  it('accepts the shapes a wallet actually produces', async () => {
    const { isAddress } = await load(false);
    expect(isAddress(SPACED)).toBe(true);
    expect(isAddress(DASHED)).toBe(true);
    expect(isAddress(SPACED.toLowerCase())).toBe(true);
  });

  it('refuses everything else', async () => {
    // A missing address must never become a link. The route would resolve to
    // an account page for nothing, which looks like a real answer.
    const { isAddress } = await load(false);
    expect(isAddress(null)).toBe(false);
    expect(isAddress(undefined)).toBe(false);
    expect(isAddress('')).toBe(false);
    expect(isAddress('Pilot 4F2A')).toBe(false);
    expect(isAddress('0xdeadbeef')).toBe(false);
    expect(isAddress('NQ07')).toBe(false);
  });
});

describe('the link', () => {
  it('joins the groups with dashes, which is what the route wants', async () => {
    // Spaces would be percent-encoded and the route would not match.
    const { accountUrl } = await load(false);
    expect(accountUrl(SPACED)).toBe(`https://nimiqscan.com/account/${DASHED}`);
  });

  it('leaves an already dashed address alone', async () => {
    const { accountUrl } = await load(false);
    expect(accountUrl(DASHED)).toBe(`https://nimiqscan.com/account/${DASHED}`);
  });

  it('follows the network switch to the testnet explorer', async () => {
    // A mainnet explorer asked about a testnet address answers "not found",
    // which a player reads as their score being rejected.
    const { accountUrl } = await load(true);
    expect(accountUrl(SPACED)).toBe(`https://testnet.nimiqscan.com/account/${DASHED}`);
  });

  it('is null rather than a guess when there is no address', async () => {
    const { accountUrl } = await load(false);
    expect(accountUrl(null)).toBeNull();
    expect(accountUrl('Pilot 4F2A')).toBeNull();
  });

  it('never contains a space or a raw plus', async () => {
    const { accountUrl } = await load(false);
    const url = accountUrl(SPACED)!;
    expect(url).not.toMatch(/[\s+]/);
    expect(url).not.toContain('%20');
  });
});
