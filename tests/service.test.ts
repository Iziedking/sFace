/**
 * The server side of a challenge: who may accept it, who may settle it, and
 * what the leaderboard refuses to believe.
 *
 * The guards here are the ones a client has an incentive to skip, so none of
 * them may be enforced only in the UI. Each test below is a request the client
 * could make and the server has to refuse on its own.
 */

import { describe, expect, it, beforeEach } from 'vitest';

import * as challenges from '../server/challenges';
import * as board from '../server/leaderboard';

const CREATOR = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
const OPPONENT = 'ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100';
const THIRD = '1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff';
const ADDRESS_A = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000';
const ADDRESS_B = 'NQ42 ABCD EFGH JKLM NPQR STUV XY01 2345 6789';
const TX = 'ab'.repeat(40);

function open(overrides: Partial<Parameters<typeof challenges.create>[0]> = {}) {
  const result = challenges.create({
    deviceId: CREATOR,
    name: 'Pilot A1B2',
    address: ADDRESS_A,
    date: '2026-07-28',
    seed: 'seed',
    stakeNim: 5,
    score: 4200,
    ...overrides,
  });
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

describe('challenge lifecycle', () => {
  it('opens with no opponent and nothing settled', () => {
    const challenge = open();
    expect(challenge.status).toBe('open');
    expect(challenge.opponentId).toBeNull();
    expect(challenge.settlementTx).toBeNull();
  });

  it('refuses a stake outside the allowed range', () => {
    expect(challenges.create({
      deviceId: CREATOR, name: 'n', address: ADDRESS_A, date: '2026-07-28',
      seed: 's', stakeNim: 0, score: 10,
    }).ok).toBe(false);

    expect(challenges.create({
      deviceId: CREATOR, name: 'n', address: ADDRESS_A, date: '2026-07-28',
      seed: 's', stakeNim: challenges.MAX_STAKE_NIM + 1, score: 10,
    }).ok).toBe(false);
  });

  it('will not let you take your own bet', () => {
    const challenge = open();
    const result = challenges.accept(challenge.id, {
      deviceId: CREATOR,
      name: 'Myself',
      address: ADDRESS_A,
      score: 999_999,
      seed: 'seed',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(409);
  });

  it('resolves to the first opponent and closes to everyone after', () => {
    const challenge = open();

    const first = challenges.accept(challenge.id, {
      deviceId: OPPONENT, name: 'Pilot FFEE', address: ADDRESS_B, score: 3100, seed: 'seed',
    });
    expect(first.ok).toBe(true);

    // Someone else arriving later, or the same request replayed, must not be
    // able to overwrite a resolved result with a better score.
    const second = challenges.accept(challenge.id, {
      deviceId: THIRD, name: 'Late', address: ADDRESS_B, score: 99_999, seed: 'seed',
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe(409);

    const current = challenges.get(challenge.id);
    expect(current.ok && current.value.opponentScore).toBe(3100);
  });

  /**
   * The bet is that two people ran the same level. The level is generated from
   * the seed, so a score set on any other seed is not comparable and must not
   * resolve the challenge. This is the failure that would settle money on two
   * different games without anyone seeing an error.
   */
  it('refuses a score set on a different seed', () => {
    const challenge = open();

    const wrongLevel = challenges.accept(challenge.id, {
      deviceId: OPPONENT,
      name: 'Pilot FFEE',
      address: ADDRESS_B,
      score: 99_999,
      seed: 'a-different-day',
    });

    expect(wrongLevel.ok).toBe(false);
    if (!wrongLevel.ok) expect(wrongLevel.code).toBe(409);

    // And the challenge is untouched, still open to a legitimate opponent.
    const current = challenges.get(challenge.id);
    expect(current.ok && current.value.status).toBe('open');
    expect(current.ok && current.value.opponentId).toBeNull();
  });

  it('refuses an unknown challenge id', () => {
    const result = challenges.get('not-a-real-id');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(404);
  });
});

describe('settlement guards', () => {
  it('only lets the loser settle', () => {
    const challenge = open();
    challenges.accept(challenge.id, {
      deviceId: OPPONENT, name: 'Pilot FFEE', address: ADDRESS_B, score: 3100, seed: 'seed',
    });

    // The creator won, so the creator paying would be nonsense.
    const wrongWay = challenges.reportSettlement(challenge.id, {
      deviceId: CREATOR,
      serializedTx: TX,
    });
    expect(wrongWay.ok).toBe(false);
    if (!wrongWay.ok) expect(wrongWay.code).toBe(403);

    const rightWay = challenges.reportSettlement(challenge.id, {
      deviceId: OPPONENT,
      serializedTx: TX,
    });
    expect(rightWay.ok).toBe(true);
    if (rightWay.ok) expect(rightWay.value.status).toBe('settled');
  });

  it('follows the winner when the opponent is the one who won', () => {
    const challenge = open();
    challenges.accept(challenge.id, {
      deviceId: OPPONENT, name: 'Pilot FFEE', address: ADDRESS_B, score: 9000, seed: 'seed',
    });

    expect(challenges.reportSettlement(challenge.id, {
      deviceId: OPPONENT, serializedTx: TX,
    }).ok).toBe(false);

    expect(challenges.reportSettlement(challenge.id, {
      deviceId: CREATOR, serializedTx: TX,
    }).ok).toBe(true);
  });

  it('refuses to settle a challenge nobody has accepted yet', () => {
    const challenge = open();
    const result = challenges.reportSettlement(challenge.id, {
      deviceId: OPPONENT,
      serializedTx: TX,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(409);
  });

  it('will not settle the same challenge twice', () => {
    const challenge = open();
    challenges.accept(challenge.id, {
      deviceId: OPPONENT, name: 'Pilot FFEE', address: ADDRESS_B, score: 3100, seed: 'seed',
    });

    expect(challenges.reportSettlement(challenge.id, {
      deviceId: OPPONENT, serializedTx: TX,
    }).ok).toBe(true);

    const replay = challenges.reportSettlement(challenge.id, {
      deviceId: OPPONENT,
      serializedTx: 'cd'.repeat(40),
    });
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.code).toBe(409);

    // And the first receipt is still the one on record.
    const current = challenges.get(challenge.id);
    expect(current.ok && current.value.settlementTx).toBe(TX);
  });
});

describe('leaderboard', () => {
  const good = {
    deviceId: CREATOR,
    name: 'Pilot A1B2',
    // Boards are per network now, so every fixture has to say which one.
    network: 'main',
    date: '2026-01-01',
    seed: 'seed-one',
    score: 4200,
    facesExtracted: 3,
    attackersCleared: 11,
    duration: 62.4,
  };

  beforeEach(() => {
    // Each block works on its own date so the boards do not bleed together.
    board.prune('2099-01-01');
  });

  it('accepts a plausible run and ranks it', () => {
    const result = board.submit({ ...good, date: '2026-02-01' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rank).toBe(1);
  });

  it('refuses a score above the game maximum', () => {
    expect(board.submit({ ...good, date: '2026-02-02', score: 999_999 }).ok).toBe(false);
  });

  it('refuses a run longer than a run can be', () => {
    expect(board.submit({ ...good, date: '2026-02-03', duration: 600 }).ok).toBe(false);
    expect(board.submit({ ...good, date: '2026-02-03', duration: 0 }).ok).toBe(false);
  });

  it('refuses a high score claimed against an impossibly short run', () => {
    expect(board.submit({ ...good, date: '2026-02-04', duration: 4, score: 9000 }).ok).toBe(false);
  });

  it('refuses more faces than the level contains', () => {
    expect(board.submit({ ...good, date: '2026-02-05', facesExtracted: 50 }).ok).toBe(false);
  });

  it('keeps one entry per device and holds their best run', () => {
    const date = '2026-03-01';
    board.submit({ ...good, date, score: 5000 });
    board.submit({ ...good, date, score: 1000 });

    const top = board.top('main', date);
    expect(top).toHaveLength(1);
    expect(top[0]?.score).toBe(5000);
  });

  it('sorts by score and breaks ties on who arrived first', () => {
    const date = '2026-03-02';
    board.submit({ ...good, date, deviceId: CREATOR, score: 1000 });
    board.submit({ ...good, date, deviceId: OPPONENT, score: 3000 });
    board.submit({ ...good, date, deviceId: THIRD, score: 3000 });

    const top = board.top('main', date);
    expect(top.map((e) => e.score)).toEqual([3000, 3000, 1000]);
    expect(top[0]?.id).toBe(OPPONENT);
  });

  it('drops boards older than a week', () => {
    board.submit({ ...good, date: '2026-04-01' });
    expect(board.top('main', '2026-04-01')).toHaveLength(1);

    board.prune('2026-05-01');
    expect(board.top('main', '2026-04-01')).toHaveLength(0);
  });
});
