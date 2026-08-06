/**
 * Anchoring a score on chain, and the five ways to fake one.
 *
 * A signed score proves who set it and puts nothing anywhere. An anchor is a
 * real Nimiq transaction carrying the score in its data field, so it has a
 * hash, an explorer entry, and a life independent of this service.
 *
 * The whole value of that rests on the service checking the transaction rather
 * than storing a hash the client typed. A hash is a string and any string will
 * do, so a board that accepted one would be publishing claims dressed as
 * receipts. Every test below is one field left unchecked, and each of them
 * makes the other four decorative.
 *
 * Transactions here are built and signed with the same library the wallet uses,
 * so this exercises the real parsing path rather than a fixture someone typed.
 */

import { describe, expect, it } from 'vitest';
import { Address, KeyPair, TransactionBuilder } from '@nimiq/core';

import {
  anchorData,
  fitsOnChain,
  isAnchorAddress,
  looksLikeHash,
  reportedAnchor,
  verifyAnchor,
} from '../server/anchor';

const ANCHOR = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000';

/*
 * A real address, derived rather than invented.
 *
 * Nimiq addresses carry a checksum, so a plausible looking string is rejected
 * by the library before any of this code sees it. Written by hand first, and
 * the test failed on the fixture rather than on the thing being tested.
 */
const ELSEWHERE = KeyPair.generate().toAddress().toUserFriendlyAddress();

/** The chain this deployment counts. Any id works so long as both sides agree. */
const NETWORK = 5;
const OTHER_CHAIN = 6;

const RUN = { date: '2026-08-06', seed: 'b3f1c9', stage: 7, score: 26_632 };

/** A real, signed transaction, exactly as the wallet's provider would return. */
function anchorTx(
  over: {
    keys?: KeyPair;
    to?: string;
    data?: string;
    networkId?: number;
    sign?: boolean;
  } = {},
) {
  const keys = over.keys ?? KeyPair.generate();
  const tx = TransactionBuilder.newBasicWithData(
    keys.toAddress(),
    Address.fromUserFriendlyAddress(over.to ?? ANCHOR),
    new TextEncoder().encode(over.data ?? anchorData(RUN)),
    BigInt(1),
    BigInt(0),
    1,
    over.networkId ?? NETWORK,
  );

  // The second argument is an inner key pair, only used for staking
  // transactions where the staker and the sender differ. Undefined here means
  // the same key signs both, which is what an ordinary transfer wants.
  if (over.sign !== false) tx.sign(keys, undefined);
  return { tx, keys, serialized: tx.toHex() };
}

function check(serialized: string, over: Partial<Parameters<typeof verifyAnchor>[0]> = {}) {
  return verifyAnchor({
    serialized,
    claim: RUN,
    anchorAddress: ANCHOR,
    networkId: NETWORK,
    ...over,
  });
}

describe('a genuine anchor', () => {
  it('is accepted, and its hash comes from the bytes', () => {
    const { tx, serialized } = anchorTx();
    const result = check(serialized);

    expect(result.ok).toBe(true);
    // Computed, not accepted: the client never gets to say what the hash is.
    expect(result.ok && result.value.hash).toBe(tx.hash());
    expect(result.ok && result.value.hash).toHaveLength(64);
  });

  it('reports the wallet that signed it', () => {
    const { keys, serialized } = anchorTx();
    const result = check(serialized);

    expect(result.ok && result.value.sender).toBe(keys.toAddress().toUserFriendlyAddress());
  });

  it('accepts the anchor address written any way', () => {
    // A wallet hands addresses back in blocks; a config file might have dashes.
    // Two spellings of one address must not read as two places.
    const { serialized } = anchorTx();
    expect(check(serialized, { anchorAddress: ANCHOR.replace(/ /g, '-') }).ok).toBe(true);
    expect(check(serialized, { anchorAddress: ANCHOR.toLowerCase() }).ok).toBe(true);
  });
});

describe('the five ways to fake one', () => {
  it('refuses a transaction that was never signed', () => {
    const { serialized } = anchorTx({ sign: false });
    expect(check(serialized).ok).toBe(false);
  });

  it('refuses one sent somewhere else', () => {
    /*
     * Without this, anybody could send themselves a transaction saying whatever
     * they liked and present it as an anchor. The recipient is what makes it
     * ours rather than merely theirs.
     */
    const { serialized } = anchorTx({ to: ELSEWHERE });
    const result = check(serialized);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/anchor/i);
  });

  it('refuses one carrying a different run', () => {
    /*
     * The one that matters most. Without it a single cheap transaction could be
     * replayed as proof of every run a player ever flew, which is the difference
     * between anchoring a score and buying a badge once.
     */
    const { serialized } = anchorTx({
      data: anchorData({ ...RUN, score: 999_999 }),
    });
    const result = check(serialized);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/does not carry this run/i);
  });

  it('refuses a run from another day, seed or stage', () => {
    for (const swap of [
      { date: '2026-08-05' },
      { seed: 'different' },
      { stage: 1 },
    ]) {
      const { serialized } = anchorTx({ data: anchorData({ ...RUN, ...swap }) });
      expect(check(serialized).ok, JSON.stringify(swap)).toBe(false);
    }
  });

  it('refuses test NIM presented as the real thing', () => {
    /*
     * A transaction on another chain verifies perfectly well against its own
     * network id. Without this check a testnet anchor, which costs nothing,
     * would sit on the board looking exactly like one that cost real NIM.
     */
    const { serialized } = anchorTx({ networkId: OTHER_CHAIN });
    const result = check(serialized);

    expect(result.ok).toBe(false);
    // And it names the id it saw, so a misconfigured deployment is one refusal
    // away from being fixed rather than a silent rejection of every anchor.
    expect(!result.ok && result.observed).toBe(OTHER_CHAIN);
  });

  it('refuses something that is not a transaction at all', () => {
    expect(check('not a transaction').ok).toBe(false);
    expect(check('').ok).toBe(false);
    expect(check('deadbeef').ok).toBe(false);
  });
});

describe('what fits on a chain', () => {
  it('accepts an ordinary run', () => {
    expect(fitsOnChain(RUN)).toBe(true);
    expect(anchorData(RUN).length).toBeLessThanOrEqual(64);
  });

  it('refuses one whose seed would overflow the data field', () => {
    // A basic transaction carries 64 bytes. Better to know before a wallet is
    // opened than to have the send refused with the player's fee already gone.
    expect(fitsOnChain({ ...RUN, seed: 'x'.repeat(80) })).toBe(false);
  });
});

describe('the configured anchor address', () => {
  it('accepts a real one', () => {
    expect(isAnchorAddress(ANCHOR)).toBe(true);
  });

  it('refuses anything that is not an address', () => {
    // Checked at boot, so a typo in the environment is caught before a player
    // sends real NIM into a hole.
    expect(isAnchorAddress('')).toBe(false);
    expect(isAnchorAddress(undefined)).toBe(false);
    expect(isAnchorAddress('NQ07 nope')).toBe(false);
  });
});

describe('when the wallet returns only an identifier', () => {
  /*
   * The failure that cost real money.
   *
   * The first version expected a serialized transaction because the SDK's type
   * says so. The SDK does not decide that: it forwards the call and hands back
   * whatever Nimiq Pay replies with. Anything unrecognised was treated as a
   * failed send, so the app said the wallet had not sent it, invited a retry,
   * and every retry paid another fee for a transaction already on its way.
   */
  it('recognises a bare transaction hash', () => {
    const hash = 'a'.repeat(64);
    expect(looksLikeHash(hash)).toBe(true);
    expect(looksLikeHash(`0x${hash}`)).toBe(true);
  });

  it('does not mistake a serialized transaction for one', () => {
    // A serialized transaction is far longer, and must take the strong path.
    const { serialized } = anchorTx();
    expect(looksLikeHash(serialized)).toBe(false);
  });

  it('records it, rather than refusing and keeping the fee', () => {
    const result = reportedAnchor('B'.repeat(64), null);

    expect(result.ok).toBe(true);
    // Lower-cased and unprefixed, so one transaction has one spelling.
    expect(result.ok && result.value.hash).toBe('b'.repeat(64));
  });

  it('marks it as the weaker claim it is', () => {
    /*
     * The service has not seen the transaction's contents, so it cannot say it
     * carries this run or went to the anchor. Labelling it the same as a checked
     * one would be the dishonesty this whole path exists to avoid.
     */
    const reported = reportedAnchor('c'.repeat(64), null);
    expect(reported.ok && reported.value.strength).toBe('reported');

    const { serialized } = anchorTx();
    const verified = check(serialized);
    expect(verified.ok && verified.value.strength).toBe('verified');
  });

  it('still refuses something that is not an identifier at all', () => {
    expect(reportedAnchor('nope', null).ok).toBe(false);
    expect(reportedAnchor('', null).ok).toBe(false);
  });
});
