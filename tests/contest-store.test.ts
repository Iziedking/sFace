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
import * as profiles from '../server/profiles';
import { obligationsOf } from '../src/data/contests';

const HOST = 'a'.repeat(64);
const RIVAL = 'b'.repeat(64);
const THIRD = 'c'.repeat(64);
const DATE = '2026-08-01';
const ADDR = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000';
const SEED = 'seed-one';

function open(over: Partial<Parameters<typeof contests.create>[0]> = {}) {
  const result = contests.create({
    network: 'main',
    hostId: HOST,
    hostName: '@host',
    hostAvatarUrl: null,
    hostAddress: ADDR,
    hostClanTag: null,
    hostOwnsClan: false,
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
    address: ADDR,
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
      network: 'main', hostId: HOST, hostName: '@host', hostAvatarUrl: null, hostAddress: ADDR,
      hostClanTag: null, hostOwnsClan: false, kind: 'duel', stages: [1], stakeNim: -1, seats: 2,
      visibility: 'open', date: DATE, seed: SEED, now: Date.now(),
    });
    expect(result.ok).toBe(false);
  });

  it('refuses a clan contest with no clan behind it', () => {
    // A contest naming a clan the host is not in would credit a roster nobody
    // on it agreed to enter.
    const result = contests.create({
      network: 'main', hostId: HOST, hostName: '@host', hostAvatarUrl: null, hostAddress: ADDR,
      hostClanTag: null, hostOwnsClan: false, kind: 'clan', stages: [1], stakeNim: 5, seats: 2,
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

describe('the rules added after the first pass', () => {
  it('lets a contest be free', () => {
    /*
     * Zero is a choice, not a missing stake. A free contest is the same seeded
     * stages and the same standings with no wallet required, which is the
     * version most people racing a friend actually want.
     */
    const c = open({ stakeNim: 0 });
    expect(c.stakeNim).toBe(0);
  });

  it('still refuses a negative stake', () => {
    const result = contests.create({
      network: 'main', hostId: HOST, hostName: '@host', hostAvatarUrl: null, hostAddress: ADDR,
      hostClanTag: null, hostOwnsClan: false, kind: 'duel', stages: [1],
      stakeNim: -1, seats: 2, visibility: 'open', date: DATE, seed: SEED, now: Date.now(),
    });
    expect(result.ok).toBe(false);
  });

  it('refuses a clan contest opened by a member', () => {
    // Every member's score counts toward the result, so entering the clan
    // commits people who have not agreed to anything. That is the owner's call.
    const result = contests.create({
      network: 'main', hostId: HOST, hostName: '@host', hostAvatarUrl: null, hostAddress: ADDR,
      hostClanTag: 'WOLF', hostOwnsClan: false, kind: 'clan', stages: [1],
      stakeNim: 5, seats: 2, visibility: 'open', date: DATE, seed: SEED, now: Date.now(),
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe(403);
  });

  it('lets the owner open one', () => {
    const result = contests.create({
      network: 'main', hostId: HOST, hostName: '@host', hostAvatarUrl: null, hostAddress: ADDR,
      hostClanTag: 'WOLF', hostOwnsClan: true, kind: 'clan', stages: [1],
      stakeNim: 5, seats: 2, visibility: 'open', date: DATE, seed: SEED, now: Date.now(),
    });
    expect(result.ok).toBe(true);
    // Two full clans, since a clan holds seven and this is clan against clan.
    expect(result.ok && result.value.seats).toBe(14);
  });

  it('refuses the gauntlet until the level exists', () => {
    /*
     * It would create, join and settle exactly like the others, and play as an
     * ordinary stage while the card promises hideouts and pickups. Shipping
     * that is worse than not shipping it: the disappointment lands after
     * somebody has staked on it.
     */
    const result = contests.create({
      network: 'main', hostId: HOST, hostName: '@host', hostAvatarUrl: null, hostAddress: ADDR,
      hostClanTag: null, hostOwnsClan: false, kind: 'gauntlet', stages: [1],
      stakeNim: 5, seats: 2, visibility: 'open', date: DATE, seed: SEED, now: Date.now(),
    });
    expect(result.ok).toBe(false);
  });
});

describe('settling a staked contest', () => {
  const ADDR_B = 'NQ34 248D 8AAA AAAA AAAA AAAA AAAA AAAA AAAA';

  function staked() {
    const c = open({ stages: [1], seats: 2, stakeNim: 5 });
    enter(c.id, RIVAL, null);
    fly(HOST, 1, 900);
    fly(RIVAL, 1, 100);
    return c;
  }

  it('refuses to open a staked contest with nowhere to be paid', () => {
    /*
     * There is no escrow, so a settlement is an ordinary transfer and a winner
     * with no address is a debt that cannot be paid however willing the loser
     * is. Refused at creation rather than discovered at the end.
     */
    const result = contests.create({
      network: 'main', hostId: HOST, hostName: '@host', hostAvatarUrl: null,
      hostAddress: null, hostClanTag: null, hostOwnsClan: false, kind: 'duel',
      stages: [1], stakeNim: 5, seats: 2, visibility: 'open',
      date: DATE, seed: SEED, now: Date.now(),
    });
    expect(result.ok).toBe(false);
  });

  it('lets a free contest be opened with no wallet at all', () => {
    const result = contests.create({
      network: 'main', hostId: HOST, hostName: '@host', hostAvatarUrl: null,
      hostAddress: null, hostClanTag: null, hostOwnsClan: false, kind: 'duel',
      stages: [1], stakeNim: 0, seats: 2, visibility: 'open',
      date: DATE, seed: SEED, now: Date.now(),
    });
    expect(result.ok).toBe(true);
  });

  it('refuses a staked seat without an address', () => {
    const c = open({ stages: [1], seats: 4, stakeNim: 5 });
    const result = contests.join({
      id: c.id, network: 'main', pilotId: RIVAL, name: '@rival',
      avatarUrl: null, address: null, clanTag: null,
    });
    expect(result.ok).toBe(false);
  });

  it('records a payment from whoever owes it', () => {
    const c = staked();
    const result = contests.markPaid({
      id: c.id, network: 'main', pilotId: RIVAL, txHash: 'abc123',
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.paid?.[RIVAL]).toBe('abc123');
  });

  it('refuses a payment from somebody who owes nothing', () => {
    // The winner cannot mark themselves settled on their own contest.
    const c = staked();
    const result = contests.markPaid({
      id: c.id, network: 'main', pilotId: HOST, txHash: 'abc123',
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toBe(409);
  });

  it('refuses a payment before the contest is over', () => {
    const c = open({ stages: [1, 2], seats: 4, stakeNim: 5 });
    enter(c.id, RIVAL, null);
    fly(HOST, 1, 900);

    expect(
      contests.markPaid({ id: c.id, network: 'main', pilotId: RIVAL, txHash: 'x' }).ok,
    ).toBe(false);
  });

  it('lists what a pilot still owes, and stops once they pay', () => {
    const c = staked();

    expect(contests.debtsFor(RIVAL, 'main').map((x) => x.id)).toEqual([c.id]);
    // The winner is never in their own debt list.
    expect(contests.debtsFor(HOST, 'main')).toEqual([]);

    contests.markPaid({ id: c.id, network: 'main', pilotId: RIVAL, txHash: 'abc123' });
    expect(contests.debtsFor(RIVAL, 'main')).toEqual([]);
  });

  it('keeps a reported payment through a restart', () => {
    // A debt that reappeared on the next deploy would nag somebody who paid.
    const c = staked();
    contests.markPaid({ id: c.id, network: 'main', pilotId: RIVAL, txHash: 'abc123' });

    contests.restore(contests.serialise());

    expect(contests.debtsFor(RIVAL, 'main')).toEqual([]);
  });

  it('does not let a free contest generate a debt', () => {
    const c = open({ stages: [1], seats: 2, stakeNim: 0 });
    enter(c.id, RIVAL, null);
    fly(HOST, 1, 900);
    fly(RIVAL, 1, 100);

    expect(contests.debtsFor(RIVAL, 'main')).toEqual([]);
    expect(ADDR_B.length).toBeGreaterThan(0);
  });
});

describe('the settlement record', () => {
  /*
   * The only accountability there is. No escrow means nothing makes a loser
   * pay, so the record of whether they do has to outlive the contest itself,
   * which is pruned two days after the level it was pinned to.
   */
  it('bills every loser exactly once, when the contest settles', () => {
    profiles.restore([]);

    const c = open({ stages: [1], seats: 2, stakeNim: 5 });
    enter(c.id, RIVAL, null);

    fly(HOST, 1, 900);
    // Not settled yet, so nobody has been billed.
    expect(settledFor(c).length).toBe(0);

    fly(RIVAL, 1, 100);

    const bills = settledFor(c);
    expect(bills.map((o) => o.fromId)).toEqual([RIVAL]);
  });

  /** The obligations a just-settled contest reports, as the route reads them. */
  function settledFor(created: { id: string }) {
    const found = contests.get(created.id, 'main');
    if (!found.ok || found.value.status !== 'settled') return [];
    return obligationsOf(found.value);
  }

  it('reports a settled contest back from recordScore, once', () => {
    /*
     * The route writes the debt on the transition into settled, so reporting it
     * twice would bill somebody twice for one loss and a record that can be
     * inflated is worse than none.
     */
    const c = open({ stages: [1], seats: 2, stakeNim: 5 });
    enter(c.id, RIVAL, null);

    const first = contests.recordScore({
      network: 'main', pilotId: HOST, date: DATE, seed: SEED, stage: 1, score: 900,
    });
    expect(first).toHaveLength(0);

    const second = contests.recordScore({
      network: 'main', pilotId: RIVAL, date: DATE, seed: SEED, stage: 1, score: 100,
    });
    expect(second.map((x) => x.id)).toEqual([c.id]);

    // Anything after the transition reports nothing, however many scores land.
    const third = contests.recordScore({
      network: 'main', pilotId: RIVAL, date: DATE, seed: SEED, stage: 1, score: 999,
    });
    expect(third).toHaveLength(0);
  });

  it('cannot be inflated past what was owed', () => {
    // The count is reported by the payer, so without the clamp a client could
    // report one settlement repeatedly and read better than perfect.
    profiles.restore([]);
    profiles.recordDebt(RIVAL, '@rival', 'main');

    profiles.recordSettlement(RIVAL, 'main');
    profiles.recordSettlement(RIVAL, 'main');
    profiles.recordSettlement(RIVAL, 'main');

    const p = profiles.get(RIVAL, 'main');
    expect(p?.stakesOwed).toBe(1);
    expect(p?.stakesSettled).toBe(1);
  });

  it('keeps the record per chain', () => {
    // Settling a faucet-NIM debt says nothing about whether you would settle a
    // real one.
    profiles.restore([]);
    profiles.recordDebt(RIVAL, '@rival', 'test');

    expect(profiles.get(RIVAL, 'test')?.stakesOwed).toBe(1);
    expect(profiles.get(RIVAL, 'main')?.stakesOwed).toBe(0);
  });

  it('survives a restart', () => {
    profiles.restore([]);
    profiles.recordDebt(RIVAL, '@rival', 'main');
    profiles.recordSettlement(RIVAL, 'main');

    profiles.restore(profiles.serialise() as unknown[]);

    const p = profiles.get(RIVAL, 'main');
    expect(p?.stakesOwed).toBe(1);
    expect(p?.stakesSettled).toBe(1);
  });
});
