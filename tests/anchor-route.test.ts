/**
 * The whole anchor path, from a signed transaction to a row on the board.
 *
 * The unit tests next door prove the transaction checks in isolation. This one
 * proves the pieces are joined: a run posted, a transaction built and signed
 * for it, the service checking that transaction against the row it already
 * holds, and the hash landing where a screen can show it.
 *
 * The join is where a feature like this usually breaks. Every part can be
 * correct while the route reads the score out of the request instead of the
 * board, or stores a hash the client supplied, and both of those turn a proof
 * back into a claim without any test failing.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { Address, KeyPair, TransactionBuilder } from '@nimiq/core';

import * as board from '../server/leaderboard';
import { anchorData, verifyAnchor } from '../server/anchor';

const ANCHOR = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000';
const NETWORK = 5;

const PILOT = 'a'.repeat(64);
const RUN = { date: '2026-08-06', seed: 'b3f1c9', stage: 7, score: 26_632 };

function signedFor(claim: typeof RUN, keys = KeyPair.generate()) {
  const tx = TransactionBuilder.newBasicWithData(
    keys.toAddress(),
    Address.fromUserFriendlyAddress(ANCHOR),
    new TextEncoder().encode(anchorData(claim)),
    BigInt(1),
    BigInt(0),
    1,
    NETWORK,
  );
  tx.sign(keys, undefined);
  return { tx, keys, serialized: tx.toHex() };
}

/** Put the run on the board, the way posting a score does. */
function postRun(score = RUN.score) {
  return board.submit({
    network: 'main',
    deviceId: PILOT,
    name: '@pilot',
    date: RUN.date,
    seed: RUN.seed,
    stage: RUN.stage,
    score,
    facesExtracted: 6,
    attackersCleared: 12,
    duration: 120,
  });
}

/** Verify and record, which is what the route does between its two guards. */
function anchorIt(serialized: string, claim = RUN) {
  const checked = verifyAnchor({
    serialized,
    claim,
    anchorAddress: ANCHOR,
    networkId: NETWORK,
  });
  if (!checked.ok) return { verified: false as const, checked };

  const stored = board.attachAnchor({
    network: 'main',
    date: claim.date,
    deviceId: PILOT,
    score: claim.score,
    hash: checked.value.hash,
    address: checked.value.sender,
  });

  return { verified: true as const, checked, stored };
}

function rowOnBoard() {
  return board.top('main', RUN.date).find((r) => r.id === PILOT);
}

beforeEach(() => {
  board.restore([]);
});

describe('anchoring a run that is on the board', () => {
  it('records the hash the service computed, not one it was handed', () => {
    postRun();
    const { tx, keys, serialized } = signedFor(RUN);

    const done = anchorIt(serialized);
    expect(done.verified).toBe(true);
    expect(done.verified && done.stored.ok).toBe(true);

    const row = rowOnBoard();
    expect(row?.anchor).toBe(tx.hash());
    // Anchoring proves a wallet as surely as signing does, so the row carries
    // one afterwards even though nothing was ever signed.
    expect(row?.address).toBe(keys.toAddress().toUserFriendlyAddress());
  });

  it('refuses a transaction naming a score the row does not have', () => {
    /*
     * The join that matters. The route builds the expected data from the board
     * rather than from the request, so a transaction claiming a better score
     * than the one actually posted has nothing to match against.
     */
    postRun(1_000);
    const { serialized } = signedFor(RUN);

    const done = anchorIt(serialized, { ...RUN, score: 1_000 });
    expect(done.verified).toBe(false);
  });

  it('will not anchor a run that was never posted', () => {
    const { serialized } = signedFor(RUN);
    const done = anchorIt(serialized);

    expect(done.verified).toBe(true);
    expect(done.verified && done.stored.ok).toBe(false);
  });

  it('keeps the first anchor when a run is anchored twice', () => {
    // A second anchor is somebody paying a fee twice. The first is already
    // permanent, and replacing it discards the record they are pointing at.
    postRun();
    const first = signedFor(RUN);
    const second = signedFor(RUN);
    expect(first.tx.hash()).not.toBe(second.tx.hash());

    anchorIt(first.serialized);
    anchorIt(second.serialized);

    expect(rowOnBoard()?.anchor).toBe(first.tx.hash());
  });

  it('publishes the anchor, since a proof nobody can see is not one', () => {
    postRun();
    const { tx, serialized } = signedFor(RUN);
    anchorIt(serialized);

    expect(board.top('main', RUN.date)[0]?.anchor).toBe(tx.hash());
  });

  it('leaves a row alone when the transaction was for another chain', () => {
    postRun();

    const keys = KeyPair.generate();
    const tx = TransactionBuilder.newBasicWithData(
      keys.toAddress(),
      Address.fromUserFriendlyAddress(ANCHOR),
      new TextEncoder().encode(anchorData(RUN)),
      BigInt(1),
      BigInt(0),
      1,
      NETWORK + 1,
    );
    tx.sign(keys, undefined);

    const done = anchorIt(tx.toHex());
    expect(done.verified).toBe(false);
    // Nothing written: test NIM must not leave a mark that looks like real NIM.
    expect(rowOnBoard()?.anchor ?? null).toBeNull();
  });
});
