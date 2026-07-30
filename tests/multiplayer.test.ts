/**
 * Challenges and clans: the two paths where a mistake costs somebody money.
 *
 * Both were built and never exercised. These were written after walking the
 * whole lifecycle against a running service by hand, and they pin the guards
 * that walk found rather than the ones that seemed likely.
 *
 * Deliberately against the modules rather than over HTTP. The routes are thin
 * wrappers around these calls, so testing here keeps the suite offline while
 * still covering the rules that decide who pays whom.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import * as challenges from '../server/challenges';
import * as clans from '../server/clans';
import * as profiles from '../server/profiles';

const SEED = '2026-07-30:m:-17.90:fng28:x1oybwdr';
const OTHER_SEED = '2026-07-30:zzz:0.00:fng50:aaaa';

/** Device ids are 64 hex characters. */
const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);
const CAROL = 'c'.repeat(64);
const TX = 'ab'.repeat(40);

function open(stake = 5, score = 4200) {
  const made = challenges.create({
    deviceId: ALICE,
    name: 'Alice',
    address: null,
    date: '2026-07-30',
    seed: SEED,
    stakeNim: stake,
    score,
  });
  if (!made.ok) throw new Error(made.reason);
  return made.value;
}

describe('a challenge, end to end', () => {
  it('opens, is taken, and resolves to the better run', () => {
    const challenge = open();
    expect(challenge.status).toBe('open');

    const taken = challenges.accept(challenge.id, {
      deviceId: BOB,
      name: 'Bob',
      address: null,
      score: 3100,
      seed: SEED,
    });

    expect(taken.ok).toBe(true);
    expect(taken.ok && taken.value.status).toBe('resolved');
    expect(taken.ok && taken.value.opponentScore).toBe(3100);
  });

  it('refuses a score set on a different mission', () => {
    /*
     * The guard the whole bet rests on.
     *
     * Two people staking NIM have to have flown the same level. Without this a
     * challenger could play an easier day and post the number against somebody
     * else's seed, and the service would settle it as if the two were
     * comparable.
     */
    const challenge = open();
    const result = challenges.accept(challenge.id, {
      deviceId: BOB,
      name: 'Bob',
      address: null,
      score: 9999,
      seed: OTHER_SEED,
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/different mission/i);
  });

  it('refuses somebody accepting their own challenge', () => {
    const challenge = open();
    const result = challenges.accept(challenge.id, {
      deviceId: ALICE,
      name: 'Alice',
      address: null,
      score: 9999,
      seed: SEED,
    });

    expect(result.ok).toBe(false);
  });

  it('refuses a third player taking one already accepted', () => {
    const challenge = open();
    challenges.accept(challenge.id, {
      deviceId: BOB,
      name: 'Bob',
      address: null,
      score: 3100,
      seed: SEED,
    });

    const late = challenges.accept(challenge.id, {
      deviceId: CAROL,
      name: 'Carol',
      address: null,
      score: 9999,
      seed: SEED,
    });

    expect(late.ok).toBe(false);
    expect(late.ok === false && late.reason).toMatch(/already been taken/i);
  });
});

describe('settling', () => {
  function resolved() {
    const challenge = open();
    challenges.accept(challenge.id, {
      deviceId: BOB,
      name: 'Bob',
      address: null,
      score: 3100,
      seed: SEED,
    });
    return challenge;
  }

  it('only lets the losing side settle', () => {
    // The winner reporting a settlement would let them mark a debt paid that
    // nobody paid.
    const challenge = resolved();
    const byWinner = challenges.reportSettlement(challenge.id, {
      deviceId: ALICE,
      serializedTx: TX,
    });

    expect(byWinner.ok).toBe(false);
    expect(byWinner.ok === false && byWinner.reason).toMatch(/losing side/i);
  });

  it('records the transaction the loser reports', () => {
    const challenge = resolved();
    const paid = challenges.reportSettlement(challenge.id, {
      deviceId: BOB,
      serializedTx: TX,
    });

    expect(paid.ok).toBe(true);
    expect(paid.ok && paid.value.status).toBe('settled');
    expect(paid.ok && paid.value.settlementTx).toBe(TX);
  });

  it('refuses a second settlement', () => {
    const challenge = resolved();
    challenges.reportSettlement(challenge.id, { deviceId: BOB, serializedTx: TX });

    const again = challenges.reportSettlement(challenge.id, {
      deviceId: BOB,
      serializedTx: TX,
    });

    expect(again.ok).toBe(false);
    expect(again.ok === false && again.reason).toMatch(/already settled/i);
  });

  it('refuses to settle one nobody has taken yet', () => {
    const challenge = open();
    const early = challenges.reportSettlement(challenge.id, {
      deviceId: BOB,
      serializedTx: TX,
    });

    expect(early.ok).toBe(false);
  });
});

describe('clans', () => {
  beforeEach(() => {
    profiles.ensure(ALICE, 'Alice');
    profiles.ensure(BOB, 'Bob');
    profiles.ensure(CAROL, 'Carol');
  });

  it('founds a clan for the first member in', () => {
    const tag = clans.normaliseTag('WOLF')!;
    const outcome = clans.join(ALICE, 'Alice', tag, Date.now());
    expect(outcome.status).toBe('founded');
  });

  it('accepts a tag however it was typed', () => {
    // Somebody sharing a clan by word of mouth will not match the case, and a
    // second clan created by a stray space is a clan split in half.
    expect(clans.normaliseTag(' wolf ')).toBe('WOLF');
    expect(clans.normaliseTag('WoLf')).toBe('WOLF');
  });

  it('refuses a tag that is not two to four characters', () => {
    expect(clans.normaliseTag('W')).toBeNull();
    expect(clans.normaliseTag('TOOLONG')).toBeNull();
  });

  it('holds a later joiner until the owner decides', () => {
    const tag = clans.normaliseTag('PACK')!;
    clans.join(ALICE, 'Alice', tag, Date.now());

    const asked = clans.join(BOB, 'Bob', tag, Date.now());
    expect(asked.status).toBe('requested');
  });

  it('only lets the owner decide', () => {
    // Otherwise anybody could admit themselves, and a clan table is a contest
    // with a prize attached.
    const tag = clans.normaliseTag('HERD')!;
    clans.join(ALICE, 'Alice', tag, Date.now());
    clans.join(BOB, 'Bob', tag, Date.now());

    const byStranger = clans.decide(tag, CAROL, BOB, true);

    expect(byStranger.ok).toBe(false);
  });

  it('admits an approved member and counts their Face', () => {
    const tag = clans.normaliseTag('CREW')!;
    clans.join(ALICE, 'Alice', tag, Date.now());
    clans.join(BOB, 'Bob', tag, Date.now());

    const decided = clans.decide(tag, ALICE, BOB, true);
    expect(decided.ok).toBe(true);

    const detail = clans.detail(tag);
    expect(detail?.members).toBe(2);
  });
});
