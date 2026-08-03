/**
 * Deadlines, and the two ways one can quietly take somebody's money.
 *
 * A contest is pinned to a seeded level that only exists for its own UTC day,
 * so every window has a hard ceiling whatever the host asked for. The failures
 * that matter are both silent. A window that runs past the rollover looks fine
 * on the card and cannot be flown. And an expiry that settles a contest nobody
 * finished puts a name at the top of an empty table and bills the rest of the
 * field for losing to it.
 *
 * Times here are absolute epoch milliseconds rather than offsets from the
 * machine clock, because the whole point of the ceiling is which side of
 * midnight UTC a moment falls on.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import * as challenges from '../server/challenges';
import * as contests from '../server/contests';
import {
  MAX_OPEN_MINUTES,
  MIN_OPEN_MINUTES,
  endOfUtcDay,
  expiryFor,
  isExpired,
  joinRefusal,
  obligationsOf as contestObligations,
  timeLeftLabel,
} from '../src/data/contests';

const HOST = 'a'.repeat(64);
const RIVAL = 'b'.repeat(64);
const DATE = '2026-08-01';
const SEED = 'seed-one';
const ADDR = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000';

/** Midday on the first of August, UTC. Whole hours, so the sums are readable. */
const NOON = Date.UTC(2026, 7, 1, 12, 0, 0);
const MIDNIGHT = Date.UTC(2026, 7, 2, 0, 0, 0);
const HOUR = 3_600_000;

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
    stages: [1],
    stakeNim: 5,
    seats: 2,
    visibility: 'open',
    date: DATE,
    seed: SEED,
    now: NOON,
    ...over,
  });
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

beforeEach(() => {
  contests.restore([]);
  challenges.restore([]);
});

describe('working out the deadline', () => {
  it('runs to midnight UTC when no window is set', () => {
    // The level dies at the rollover, so the whole rest of the day is the most
    // anybody can be given.
    expect(expiryFor(NOON, null)).toBe(MIDNIGHT);
    expect(endOfUtcDay(NOON)).toBe(MIDNIGHT);
  });

  it('takes the window the host asked for', () => {
    expect(expiryFor(NOON, 90)).toBe(NOON + 90 * 60_000);
  });

  it('caps a long window at the rollover', () => {
    /*
     * The one that matters. Twenty four hours from noon is noon tomorrow, and
     * the seed will not exist then, so a card promising a full day would be
     * selling twelve hours that cannot be flown.
     */
    expect(expiryFor(NOON, MAX_OPEN_MINUTES)).toBe(MIDNIGHT);
  });

  it('holds a short window to the floor', () => {
    // Under half an hour, the other side cannot realistically see it, take a
    // seat and fly, which makes opening one late a way of winning by default.
    expect(expiryFor(NOON, 5)).toBe(NOON + MIN_OPEN_MINUTES * 60_000);
  });

  it('gives what is left of the day near midnight, however long was asked', () => {
    const tenToMidnight = MIDNIGHT - 10 * 60_000;
    expect(expiryFor(tenToMidnight, MIN_OPEN_MINUTES)).toBe(MIDNIGHT);
  });
});

describe('what the card says', () => {
  it('reads in hours and minutes', () => {
    expect(timeLeftLabel({ expiresAt: NOON + 2 * HOUR + 15 * 60_000 }, NOON)).toBe('2h 15m left');
    expect(timeLeftLabel({ expiresAt: NOON + 2 * HOUR }, NOON)).toBe('2h left');
    expect(timeLeftLabel({ expiresAt: NOON + 40 * 60_000 }, NOON)).toBe('40m left');
  });

  it('says expired rather than a negative number', () => {
    expect(timeLeftLabel({ expiresAt: NOON - 1 }, NOON)).toBe('Expired');
  });
});

describe('taking a seat', () => {
  it('is refused once the clock has passed', () => {
    const contest = { ...contests.toPublic(open()), expiresAt: NOON - 1 };
    const refusal = joinRefusal(contest, { id: RIVAL, clanTag: null }, NOON);
    expect(refusal).toMatch(/clock ran out/i);
  });

  it('says the clock rather than the seat count', () => {
    /*
     * An expired contest usually still has a free seat, and "it is full" would
     * be a true-sounding refusal for the wrong reason. The person reading it
     * would go looking for another seat that does not exist.
     */
    const contest = { ...contests.toPublic(open({ seats: 4 })), expiresAt: NOON - 1 };
    expect(joinRefusal(contest, { id: RIVAL, clanTag: null }, NOON)).toMatch(/clock/i);
  });

  it('is allowed right up to the deadline', () => {
    const contest = { ...contests.toPublic(open({ seats: 4 })), expiresAt: NOON + 1 };
    expect(joinRefusal(contest, { id: RIVAL, clanTag: null }, NOON)).toBeNull();
  });

  it('is refused by the store too, not only by the rule', () => {
    const contest = open({ seats: 4 });
    const late = contests.join({
      id: contest.id,
      network: 'main',
      pilotId: RIVAL,
      name: '@rival',
      avatarUrl: null,
      address: ADDR,
      clanTag: null,
      now: contest.expiresAt + 1,
    });
    expect(late.ok).toBe(false);
  });
});

describe('a run that lands late', () => {
  it('does not count toward the contest', () => {
    const contest = open({ seats: 2 });
    contests.recordScore({
      network: 'main',
      pilotId: HOST,
      date: DATE,
      seed: SEED,
      stage: 1,
      score: 900,
      now: contest.expiresAt + 1,
    });

    const after = contests.get(contest.id, 'main');
    // The run still goes on the daily board. It just does not count toward
    // terms whose window closed, or the deadline is advisory for the slowest.
    expect(after.ok && after.value.entrants[0]!.scores[1]).toBeUndefined();
  });
});

describe('the sweep', () => {
  it('settles on whoever flew when the clock runs out', () => {
    const contest = open({ seats: 2 });
    contests.join({
      id: contest.id,
      network: 'main',
      pilotId: RIVAL,
      name: '@rival',
      avatarUrl: null,
      address: ADDR,
      clanTag: null,
      now: NOON,
    });
    contests.recordScore({
      network: 'main', pilotId: HOST, date: DATE, seed: SEED, stage: 1, score: 900, now: NOON,
    });

    const settled = contests.expireDue(contest.expiresAt + 1);
    expect(settled.map((c) => c.id)).toEqual([contest.id]);

    const after = contests.get(contest.id, 'main');
    expect(after.ok && after.value.status).toBe('settled');
    expect(contests.winnerOf(contests.toPublic(after.ok ? after.value : contest))?.id).toBe(HOST);
  });

  it('bills the entrant who never turned up', () => {
    // They agreed to the stake, and walking away from a run you are losing
    // cannot be a way out of it.
    const contest = open({ seats: 2, stakeNim: 5 });
    contests.join({
      id: contest.id,
      network: 'main',
      pilotId: RIVAL,
      name: '@rival',
      avatarUrl: null,
      address: ADDR,
      clanTag: null,
      now: NOON,
    });
    contests.recordScore({
      network: 'main', pilotId: HOST, date: DATE, seed: SEED, stage: 1, score: 900, now: NOON,
    });

    const [settled] = contests.expireDue(contest.expiresAt + 1);
    const owed = settled ? obligations(settled) : [];
    expect(owed).toEqual([{ from: RIVAL, to: HOST, nim: 5 }]);
  });

  it('voids one nobody finished, and creates no debt', () => {
    /*
     * The failure this whole file exists for. standings puts unfinished
     * entrants at the bottom, so settling an untouched contest would crown
     * whoever sorted first and bill everybody else for losing to a person who
     * also never flew.
     */
    const contest = open({ seats: 2, stakeNim: 5 });
    contests.join({
      id: contest.id,
      network: 'main',
      pilotId: RIVAL,
      name: '@rival',
      avatarUrl: null,
      address: ADDR,
      clanTag: null,
      now: NOON,
    });

    const settled = contests.expireDue(contest.expiresAt + 1);
    expect(settled).toHaveLength(0);

    const after = contests.get(contest.id, 'main');
    expect(after.ok && after.value.status).toBe('void');
    expect(after.ok ? obligations(contests.toPublic(after.value)) : null).toEqual([]);
    expect(after.ok ? contests.winnerOf(contests.toPublic(after.value)) : 'x').toBeNull();
  });

  it('reports each contest once, however often it is swept', () => {
    // The caller writes a debt record per settlement, so a second report would
    // bill somebody twice for one loss.
    //
    // The no-show is what keeps it pending until the clock: a contest whose
    // every entrant has flown settles at the last score, with no expiry
    // involved, which is the ordinary path and not the one under test.
    const contest = open({ seats: 2, stakeNim: 5 });
    contests.join({
      id: contest.id,
      network: 'main',
      pilotId: RIVAL,
      name: '@rival',
      avatarUrl: null,
      address: ADDR,
      clanTag: null,
      now: NOON,
    });
    contests.recordScore({
      network: 'main', pilotId: HOST, date: DATE, seed: SEED, stage: 1, score: 900, now: NOON,
    });

    expect(contests.expireDue(contest.expiresAt + 1)).toHaveLength(1);
    expect(contests.expireDue(contest.expiresAt + 2)).toHaveLength(0);
  });

  it('leaves a live contest alone', () => {
    const contest = open({ seats: 4 });
    expect(contests.expireDue(contest.expiresAt - 1)).toHaveLength(0);
    const after = contests.get(contest.id, 'main');
    expect(after.ok && after.value.status).toBe('open');
  });
});

describe('the public list', () => {
  it('drops an expired contest without waiting for the sweep', () => {
    // A listed contest is one you can still take a seat in, and the sweep runs
    // on a schedule. Between two ticks the list would offer a dead seat.
    const contest = open({ seats: 4 });
    expect(contests.list('main', NOON)).toHaveLength(1);
    expect(contests.list('main', contest.expiresAt + 1)).toHaveLength(0);
  });
});

describe('rows written before deadlines existed', () => {
  /*
   * The one that only appears on the deployed service.
   *
   * The snapshot on disk predates this field, so every restored contest has no
   * expiresAt. Undefined loses every comparison against the clock, which does
   * not throw and does not look wrong: it produces a contest that is listed
   * forever, joinable forever, on a level that stopped existing days ago.
   */
  it('get a deadline at the end of the day they were opened', () => {
    contests.restore([
      {
        id: 'old',
        kind: 'duel',
        stages: [1],
        stakeNim: 0,
        seats: 2,
        visibility: 'open',
        status: 'open',
        date: DATE,
        seed: SEED,
        hostId: HOST,
        hostName: '@host',
        hostAvatarUrl: null,
        clanTag: null,
        entrants: [],
        network: 'main',
        createdAt: NOON,
      },
    ]);

    const found = contests.get('old', 'main');
    expect(found.ok && found.value.expiresAt).toBe(MIDNIGHT);
    // And it actually dies, which is the whole point of the backfill.
    expect(contests.list('main', MIDNIGHT + 1)).toHaveLength(0);
  });

  it('are not resurrected by a second restore', () => {
    // Restoring twice used to merge rather than replace on the challenge store,
    // which quietly brings back rows that were deliberately dropped.
    challenges.restore([
      {
        id: 'old',
        date: DATE,
        seed: SEED,
        stakeNim: 5,
        creatorId: HOST,
        creatorName: '@host',
        creatorAddress: ADDR,
        creatorScore: 900,
        opponentId: null,
        opponentName: null,
        opponentAddress: null,
        opponentScore: null,
        status: 'open',
        settlementTx: null,
        // Now, for the same reason: get() enforces a TTL against the wall clock
        // and a fixed date would make this test expire on its own.
        createdAt: Date.now(),
      } as never,
    ]);
    expect(challenges.get('old').ok).toBe(true);

    challenges.restore([]);
    expect(challenges.get('old').ok).toBe(false);
  });

  it('give a restored challenge the same day-end deadline', () => {
    /*
     * Created now rather than on a fixed date, because get() also enforces a
     * 48 hour TTL against the wall clock. A hardcoded day would pass today and
     * start failing on its own two days later, which is a test that lies about
     * when it broke.
     */
    const born = Date.now();

    challenges.restore([
      {
        id: 'old',
        date: DATE,
        seed: SEED,
        stakeNim: 5,
        creatorId: HOST,
        creatorName: '@host',
        creatorAddress: ADDR,
        creatorScore: 900,
        opponentId: null,
        opponentName: null,
        opponentAddress: null,
        opponentScore: null,
        status: 'open',
        settlementTx: null,
        createdAt: born,
      } as never,
    ]);

    const dayEnd = endOfUtcDay(born);
    const found = challenges.get('old');
    expect(found.ok && found.value.expiresAt).toBe(dayEnd);
    expect(found.ok && challenges.isOver(found.value, dayEnd + 1)).toBe(true);
  });
});

describe('challenges expire the same way', () => {
  function challenge(openMinutes: number | null = null) {
    const result = challenges.create({
      deviceId: HOST,
      name: '@host',
      address: ADDR,
      date: DATE,
      seed: SEED,
      stakeNim: 5,
      score: 900,
      openMinutes,
    });
    if (!result.ok) throw new Error(result.reason);
    return result.value;
  }

  it('carries a deadline no later than the rollover', () => {
    const made = challenge(MAX_OPEN_MINUTES);
    expect(made.expiresAt).toBeLessThanOrEqual(endOfUtcDay(Date.now()));
    expect(made.expiresAt).toBeGreaterThan(Date.now());
  });

  it('refuses an answer after the clock', () => {
    const made = challenge();
    const answered = challenges.accept(made.id, {
      deviceId: RIVAL,
      name: '@rival',
      address: ADDR,
      score: 950,
      seed: SEED,
    });
    // Still answerable now, so the refusal below is the clock and nothing else.
    expect(answered.ok).toBe(true);

    const stale = challenge();
    stale.expiresAt = Date.now() - 1;
    expect(challenges.isOver(stale)).toBe(true);
    const late = challenges.accept(stale.id, {
      deviceId: RIVAL,
      name: '@rival',
      address: ADDR,
      score: 950,
      seed: SEED,
    });
    expect(late.ok).toBe(false);
    expect(!late.ok && late.code).toBe(410);
  });

  it('leaves a resolved one alone once the clock passes', () => {
    /*
     * Both scores are in, so nothing about the result depends on the clock any
     * more. Expiring it here would take away a result that was fairly reached
     * while somebody was owed on it.
     */
    const made = challenge();
    challenges.accept(made.id, {
      deviceId: RIVAL, name: '@rival', address: ADDR, score: 950, seed: SEED,
    });
    made.expiresAt = Date.now() - 1;
    expect(challenges.isOver(made)).toBe(false);
    expect(isExpired(made, Date.now())).toBe(true);
  });
});

/** The obligations on a contest, flattened to what the assertions care about. */
function obligations(contest: Parameters<typeof contests.winnerOf>[0]) {
  return contestObligations(contest).map((o) => ({ from: o.fromId, to: o.toId, nim: o.nim }));
}
