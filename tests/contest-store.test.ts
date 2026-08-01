/**
 * The contest store, and the four ways it could quietly be wrong.
 *
 * These settle for NIM, so every failure that matters here is silent: a private
 * contest in a public list, a stage flown twice until it beat somebody, a
 * testnet entrant on a mainnet stake, or a result that never arrives because
 * one seat was abandoned. None of them throw. All of them look like a working
 * feature until somebody loses money to one.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import * as contests from '../server/contests';

const HOST = 'a'.repeat(64);
const RIVAL = 'b'.repeat(64);
const THIRD = 'c'.repeat(64);
const DATE = '2026-08-01';
const SEED = 'seed-one';

function open(over: Partial<Parameters<typeof contests.create>[0]> = {}) {
  const result = contests.create({
    network: 'main',
    hostId: HOST,
    hostName: '@host',
    hostAvatarUrl: null,
    hostClanTag: null,
    kind: 'duel',
    stages: [1, 2],
    stakeNim: 5,
    seats: 2,
    visibility: 'open',
    date: DATE,
    seed: SEED,
    now: Date.now(),
    ...over,
  });
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

function enter(id: string, pilotId: string, clanTag: string | null = null, network = 'main') {
  return contests.join({
    id,
    network,
    pilotId,
    name: `@${pilotId.slice(0, 4)}`,
    avatarUrl: null,
    clanTag,
  });
}

function fly(pilotId: string, stage: number, score: number, network = 'main') {
  contests.recordScore({ network, pilotId, date: DATE, seed: SEED, stage, score });
}

beforeEach(() => {
  contests.restore([]);
});

describe('opening one', () => {
  it('puts the host in it', () => {
    // Otherwise somebody could set terms they never have to fly.
    const c = open();
    expect(c.entrants.map((e) => e.id)).toEqual([HOST]);
  });

  it('tidies the stage list rather than trusting it', () => {
    const c = open({ stages: [3, 1, 3, 9, 0, 2] });
    expect(c.stages).toEqual([1, 2, 3]);
  });

  it('refuses a stake outside the bounds', () => {
    const result = contests.create({
      network: 'main', hostId: HOST, hostName: '@host', hostAvatarUrl: null,
      hostClanTag: null, kind: 'duel', stages: [1], stakeNim: 0, seats: 2,
      visibility: 'open', date: DATE, seed: SEED, now: Date.now(),
    });
    expect(result.ok).toBe(false);
  });

  it('refuses a clan contest with no clan behind it', () => {
    // A contest naming a clan the host is not in would credit a roster nobody
    // on it agreed to enter.
    const result = contests.create({
      network: 'main', hostId: HOST, hostName: '@host', hostAvatarUrl: null,
      hostClanTag: null, kind: 'clan', stages: [1], stakeNim: 5, seats: 2,
      visibility: 'open', date: DATE, seed: SEED, now: Date.now(),
    });
    expect(result.ok).toBe(false);
  });
});

describe('the public list', () => {
  it('never carries a private contest', () => {
    /*
     * The link is the whole access control. A payload that carried private
     * contests would hand them to anyone who opened the network tab, and
     * filtering on the client would make it a promise kept by the reader.
     */
    open({ visibility: 'private' });
    const shown = open({ visibility: 'open' });

    expect(contests.list('main').map((c) => c.id)).toEqual([shown.id]);
  });

  it('does not leak across chains', () => {
    open({ network: 'test' });
    expect(contests.list('main')).toHaveLength(0);
    expect(contests.list('test')).toHaveLength(1);
  });

  it('drops the settled ones', () => {
    const c = open({ stages: [1], seats: 2 });
    enter(c.id, RIVAL);
    fly(HOST, 1, 500);
    fly(RIVAL, 1, 400);

    expect(contests.list('main')).toHaveLength(0);
  });
});

describe('reading one', () => {
  it('is not found from the other chain', () => {
    // Refusing by name would confirm the id exists, which a testnet caller has
    // no business learning.
    const c = open();
    const found = contests.get(c.id, 'test');

    expect(found.ok).toBe(false);
    expect(found.ok === false && found.code).toBe(404);
  });
});

describe('taking a seat', () => {
  it('fills up and then refuses', () => {
    const c = open({ seats: 2 });
    expect(enter(c.id, RIVAL).ok).toBe(true);
    expect(enter(c.id, THIRD).ok).toBe(false);
  });

  it('flips to running once full, so the terms are fixed', () => {
    const c = open({ seats: 2 });
    const after = enter(c.id, RIVAL);
    expect(after.ok && after.value.status).toBe('running');
  });

  it('refuses the same pilot twice', () => {
    const c = open({ seats: 4 });
    enter(c.id, RIVAL);
    expect(enter(c.id, RIVAL).ok).toBe(false);
  });
});

describe('scores landing', () => {
  it('only counts stages the contest asked for', () => {
    const c = open({ stages: [1, 2], seats: 4 });
    fly(HOST, 3, 9_000);

    const after = contests.get(c.id, 'main');
    expect(after.ok && after.value.entrants[0]!.scores[3]).toBeUndefined();
  });

  it('keeps the first attempt, not the best', () => {
    /*
     * The daily board keeps your best. A contest cannot: replaying a stage
     * until it beat whatever the other side posted is not a race, and whoever
     * went first would be the only one playing fair.
     */
    const c = open({ stages: [1], seats: 4 });
    fly(HOST, 1, 300);
    fly(HOST, 1, 9_000);

    const after = contests.get(c.id, 'main');
    expect(after.ok && after.value.entrants[0]!.scores[1]).toBe(300);
  });

  it('ignores a run on another day or another level', () => {
    const c = open({ stages: [1], seats: 4 });
    contests.recordScore({
      network: 'main', pilotId: HOST, date: '2026-07-31', seed: SEED, stage: 1, score: 500,
    });
    contests.recordScore({
      network: 'main', pilotId: HOST, date: DATE, seed: 'other-seed', stage: 1, score: 500,
    });

    const after = contests.get(c.id, 'main');
    expect(after.ok && after.value.entrants[0]!.scores[1]).toBeUndefined();
  });

  it('does not credit somebody who never entered', () => {
    const c = open({ stages: [1], seats: 4 });
    fly(THIRD, 1, 900);

    const after = contests.get(c.id, 'main');
    expect(after.ok && after.value.entrants).toHaveLength(1);
  });

  it('does not cross chains', () => {
    // A testnet run must never touch a contest staked in real NIM.
    const c = open({ stages: [1], seats: 4 });
    fly(HOST, 1, 500, 'test');

    const after = contests.get(c.id, 'main');
    expect(after.ok && after.value.entrants[0]!.scores[1]).toBeUndefined();
  });
});

describe('settling', () => {
  it('waits for everyone entered to finish', () => {
    const c = open({ stages: [1, 2], seats: 4 });
    enter(c.id, RIVAL);

    fly(HOST, 1, 500);
    fly(HOST, 2, 500);
    fly(RIVAL, 1, 900);

    const mid = contests.get(c.id, 'main');
    expect(mid.ok && mid.value.status).not.toBe('settled');
    expect(contests.winnerOf(mid.ok ? mid.value : c)).toBeNull();
  });

  it('names the best average once everyone has flown', () => {
    const c = open({ stages: [1, 2], seats: 4 });
    enter(c.id, RIVAL);

    /*
     * HOST posts the single best stage in the contest and still loses.
     *
     * 9,000 then 0 averages 4,500. A steady 5,000 twice averages 5,000. On
     * best-of HOST takes it on the strength of one stage; on the average RIVAL
     * takes it for being better over the whole thing, which is what the two of
     * them agreed to settle.
     */
    fly(HOST, 1, 9_000);
    fly(HOST, 2, 0);
    fly(RIVAL, 1, 5_000);
    fly(RIVAL, 2, 5_000);

    const after = contests.get(c.id, 'main');
    expect(after.ok && after.value.status).toBe('settled');
    expect(contests.winnerOf(after.ok ? after.value : c)?.id).toBe(RIVAL);
  });

  it('ends on the entrants it has, not the seats it wanted', () => {
    // An abandoned seat would otherwise hold the result, and the stake, open
    // forever.
    const c = open({ stages: [1], seats: 6 });
    fly(HOST, 1, 500);

    const after = contests.get(c.id, 'main');
    expect(after.ok && after.value.status).toBe('settled');
  });
});

describe('persistence', () => {
  it('survives a restart with scores intact', () => {
    const c = open({ stages: [1], seats: 4 });
    enter(c.id, RIVAL);
    fly(HOST, 1, 700);

    contests.restore(contests.serialise());

    const after = contests.get(c.id, 'main');
    expect(after.ok && after.value.entrants).toHaveLength(2);
    expect(after.ok && after.value.entrants[0]!.scores[1]).toBe(700);
  });

  it('replaces rather than merges', () => {
    // The board store had this wrong: a row dropped from a snapshot survived
    // the next restore and reappeared as something nobody could account for.
    open();
    contests.restore([]);

    expect(contests.count()).toBe(0);
  });

  it('drops contests whose day has gone', () => {
    const old = Date.now() - 72 * 3_600_000;
    open({ now: old });
    open();

    contests.prune(Date.now());
    expect(contests.count()).toBe(1);
  });
});
