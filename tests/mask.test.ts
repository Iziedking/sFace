/**
 * The wallet as it reads under a name.
 *
 * Addresses arrive from the wallet in blocks separated by spaces and from a URL
 * separated by dashes, and both have to shorten the same way or the same pilot
 * appears twice on one board looking like two people.
 */

import { describe, expect, it } from 'vitest';

import { maskAddress } from '../src/ui/screens';

const FULL = 'NQ21 YC9E 8T2M 4KLA 9XQR 7B3D 5FGH 1JKM 78EF';

describe('shortening an address', () => {
  it('keeps the ends, which is what people recognise', () => {
    expect(maskAddress(FULL)).toBe('NQ21 YC9E … 78EF');
  });

  it('reads a dashed address the same way', () => {
    // A URL carries them dashed. Two spellings of one wallet must not produce
    // two different labels on the same board.
    expect(maskAddress(FULL.replace(/ /g, '-'))).toBe(maskAddress(FULL));
  });

  it('shouts a lowercase one', () => {
    expect(maskAddress(FULL.toLowerCase())).toBe('NQ21 YC9E … 78EF');
  });

  it('leaves something that is not an address alone', () => {
    // Better a short odd string than a confident slice of nonsense.
    expect(maskAddress('NQ21')).toBe('NQ21');
    expect(maskAddress('')).toBe('');
  });
});
