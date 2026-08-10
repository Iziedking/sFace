import { describe, expect, it } from 'vitest';

import {
  encodeChallenge,
  encodeMergeClaim,
  mergeBodyDigest,
  type Challenge,
  type MergeClaim,
} from '../src/net/player-auth-protocol';

const claim: MergeClaim = { from: 'a'.repeat(64), into: 'b'.repeat(64), network: 'main' };
const challenge: Challenge = {
  id: 'challenge-1',
  action: 'profile.merge',
  playerId: 'a'.repeat(64),
  bodyDigest: 'c'.repeat(64),
  nonce: 'd'.repeat(32),
  expiresAt: 1_700_000_000_000,
};

describe('player auth protocol', () => {
  it('encodes the same merge claim deterministically', async () => {
    expect(Array.from(encodeMergeClaim(claim))).toEqual(Array.from(encodeMergeClaim({ ...claim })));
    expect(await mergeBodyDigest(claim)).toBe(await mergeBodyDigest({ ...claim }));
  });

  it('changes the merge digest when any claim field changes', async () => {
    const original = await mergeBodyDigest(claim);
    expect(await mergeBodyDigest({ ...claim, into: 'c'.repeat(64) })).not.toBe(original);
    expect(await mergeBodyDigest({ ...claim, network: 'test' })).not.toBe(original);
  });

  it('changes the challenge bytes when action, nonce, or expiry changes', () => {
    const original = Array.from(encodeChallenge(challenge));
    expect(Array.from(encodeChallenge({ ...challenge, action: 'player.register' }))).not.toEqual(original);
    expect(Array.from(encodeChallenge({ ...challenge, nonce: 'e'.repeat(32) }))).not.toEqual(original);
    expect(Array.from(encodeChallenge({ ...challenge, expiresAt: challenge.expiresAt + 1 }))).not.toEqual(original);
  });
});
