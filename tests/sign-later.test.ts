/**
 * Signing a run after it is already on the board.
 *
 * The wallet used to be asked to sign during the post: a dialog arriving in the
 * two seconds somebody is reading their own score, asked for whenever a wallet
 * was merely present rather than connected, and so failing every time inside
 * Nimiq Pay. It is a button now, which means proof has to be attachable to a
 * row that already exists.
 *
 * Two things would break that silently, and neither would throw:
 *
 *   the board keeps the BEST run of the day, so re-posting the same score to
 *   carry a signature is ignored and the row stays unsigned;
 *
 *   the score route folds every submission into the lifetime profile, so a
 *   re-post would add the run's Face twice and reward signing with a cheat.
 *
 * Hence a path that only ever attaches proof. These pin what it must refuse.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import * as board from '../server/leaderboard';

const PILOT = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const DATE = '2026-03-01';
const SEED = 'seed-one';

const PROOF = {
  publicKey: 'c'.repeat(64),
  signature: 'd'.repeat(128),
  seed: SEED,
  stage: 3,
};

function post(deviceId: string, score: number) {
  return board.submit({
    deviceId,
    name: 'Pilot',
    network: 'main',
    date: DATE,
    score,
    facesExtracted: 3,
    attackersCleared: 11,
    duration: 62.4,
  });
}

function sign(deviceId: string, score: number, proof = PROOF) {
  return board.attachProof({
    network: 'main',
    date: DATE,
    deviceId,
    score,
    address: 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000',
    proof,
  });
}

function rowFor(deviceId: string) {
  return board.top('main', DATE).find((r) => r.id === deviceId);
}

beforeEach(() => {
  board.restore([]);
});

describe('attaching proof', () => {
  it('binds a wallet to a row that is already there', () => {
    post(PILOT, 5_000);
    expect(rowFor(PILOT)?.proof ?? null).toBeNull();

    expect(sign(PILOT, 5_000).ok).toBe(true);

    const row = rowFor(PILOT);
    expect(row?.proof?.signature).toBe(PROOF.signature);
    expect(row?.address).toBeTruthy();
  });

  it('does not move the score or the ranking', () => {
    post(PILOT, 5_000);
    post(OTHER, 9_000);

    sign(PILOT, 5_000);

    const rows = board.top('main', DATE);
    expect(rows.map((r) => r.id)).toEqual([OTHER, PILOT]);
    expect(rowFor(PILOT)?.score).toBe(5_000);
  });

  it('refuses a signature for a different run', () => {
    /*
     * The score has to match the row exactly. Without this, a signature over a
     * small run could be used to decorate a big one, and the mark on the board
     * would be attesting to a number nobody signed.
     */
    post(PILOT, 5_000);

    const result = sign(PILOT, 4_000);
    expect(result.ok).toBe(false);
    expect(rowFor(PILOT)?.proof ?? null).toBeNull();
  });

  it('refuses when there is no run of theirs to sign', () => {
    post(OTHER, 9_000);

    expect(sign(PILOT, 5_000).ok).toBe(false);
  });

  it('leaves an already signed row alone', () => {
    // A second wallet must not be able to overwrite the first one's claim on
    // somebody else's row.
    post(PILOT, 5_000);
    sign(PILOT, 5_000);

    const intruder = { ...PROOF, publicKey: 'e'.repeat(64), signature: 'f'.repeat(128) };
    sign(PILOT, 5_000, intruder);

    expect(rowFor(PILOT)?.proof?.signature).toBe(PROOF.signature);
  });

  it('is safe to repeat', () => {
    // The button can be pressed twice, and a retry after a network wobble is
    // the ordinary case rather than the strange one.
    post(PILOT, 5_000);

    expect(sign(PILOT, 5_000).ok).toBe(true);
    expect(sign(PILOT, 5_000).ok).toBe(true);
    expect(rowFor(PILOT)?.proof?.signature).toBe(PROOF.signature);
  });
});

describe('the row it attaches to', () => {
  it('survives a better run replacing it, unsigned again', () => {
    /*
     * A new best genuinely is a different run, so the old signature must not
     * carry over: it was made over the old score and would no longer verify.
     */
    post(PILOT, 5_000);
    sign(PILOT, 5_000);

    post(PILOT, 8_000);

    expect(rowFor(PILOT)?.score).toBe(8_000);
    expect(rowFor(PILOT)?.proof ?? null).toBeNull();
  });
});
