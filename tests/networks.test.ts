/**
 * Two chains, two boards.
 *
 * The README claimed testnet scores were kept off the mainnet board and they
 * were not: every score went into one table keyed only by date, so a run played
 * with faucet NIM sat beside one played for real.
 *
 * That is worth pinning rather than trusting, because nothing about playing the
 * game would reveal it. Both boards look correct on their own; the fault is only
 * visible if you know what should not be there.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import * as board from '../server/leaderboard';

const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);
const DATE = '2026-03-01';

function run(network: string, deviceId: string, score: number) {
  return board.submit({
    deviceId,
    name: deviceId === ALICE ? 'Alice' : 'Bob',
    network,
    date: DATE,
    score,
    facesExtracted: 3,
    attackersCleared: 11,
    duration: 62.4,
  });
}

describe('a score lands only on the board it was played on', () => {
  beforeEach(() => {
    board.prune('2099-01-01');
  });

  it('keeps testnet runs off the mainnet board', () => {
    run('test', ALICE, 90_000);
    run('main', BOB, 4_200);

    const live = board.top('main', DATE);
    expect(live.map((e) => e.id)).toEqual([BOB]);

    // And the testnet score is not lost, it is simply somewhere else.
    const rehearsal = board.top('test', DATE);
    expect(rehearsal.map((e) => e.id)).toEqual([ALICE]);
  });

  it('lets the same pilot hold a different score on each', () => {
    /*
     * The same device, both chains. Nothing about one should overwrite or rank
     * against the other: they are separate games that happen to share a player.
     */
    run('main', ALICE, 4_200);
    run('test', ALICE, 60_000);

    expect(board.top('main', DATE)[0]?.score).toBe(4_200);
    expect(board.top('test', DATE)[0]?.score).toBe(60_000);
  });

  it('ranks within a network, not across', () => {
    run('main', ALICE, 4_200);
    run('test', BOB, 90_000);

    // Alice is first on mainnet despite a far larger testnet score existing.
    expect(board.rankOf('main', DATE, ALICE)).toBe(1);
    // And Bob does not appear on mainnet at all.
    expect(board.rankOf('main', DATE, BOB)).toBe(0);
  });
});

describe('housekeeping survived the key change', () => {
  beforeEach(() => {
    board.prune('2099-01-01');
  });

  it('still drops boards older than a week, on both networks', () => {
    /*
     * prune used to parse the whole key as a date. With the network in front of
     * it that is NaN, every comparison against NaN is false, and nothing is ever
     * dropped: a store that grows forever without erring.
     */
    run('main', ALICE, 4_200);
    run('test', BOB, 4_200);

    board.prune('2026-04-01');

    expect(board.top('main', DATE)).toHaveLength(0);
    expect(board.top('test', DATE)).toHaveLength(0);
  });

  it('reads a snapshot written before the split as mainnet', () => {
    // The live site has real scores saved under a date-only key. Loading one
    // as-is would put them on a board no read can reach.
    board.prune('2099-01-01');
    board.restore([[DATE, [{ id: ALICE, name: 'Alice', score: 7_000, at: 1 }]]]);

    expect(board.top('main', DATE).map((e) => e.id)).toEqual([ALICE]);
    expect(board.top('test', DATE)).toHaveLength(0);
  });
});
