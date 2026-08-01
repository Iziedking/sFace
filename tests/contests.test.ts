/**
 * Who won, and who has not finished yet.
 *
 * These settle for NIM, so the two failures that matter are both silent: a
 * standing that ranks somebody on stages they have not flown, and a clan
 * contest that rewards turnout instead of flying. Neither throws. Both look
 * like a plausible table.
 */

import { describe, expect, it } from 'vitest';

import {
  averageFor,
  debtOf,
  obligationsOf,
  clanStandings,
  joinRefusal,
  seatsLeft,
  stageRange,
  stagesLabel,
  standings,
  type Contest,
  type ContestEntrant,
} from '../src/data/contests';

/** Everyone can be paid, so obligations are about who owes rather than who can. */
const ADDR = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000';

function entrant(
  id: string,
  scores: Record<number, number>,
  clanTag: string | null = null,
): ContestEntrant {
  return { id, name: `@${id}`, avatarUrl: null, address: ADDR, clanTag, scores };
}

function contest(over: Partial<Contest> = {}): Contest {
  return {
    id: 'c1',
    kind: 'duel',
    stages: [1, 2, 3],
    stakeNim: 5,
    seats: 4,
    visibility: 'open',
    status: 'open',
    date: '2026-03-01',
    seed: 'seed-one',
    hostId: 'host',
    hostName: '@host',
    hostAvatarUrl: null,
    clanTag: null,
    entrants: [],
    ...over,
  };
}

describe('stage selection', () => {
  it('builds an inclusive run', () => {
    expect(stageRange(1, 3)).toEqual([1, 2, 3]);
    expect(stageRange(4, 4)).toEqual([4]);
  });

  it('does not care which end came first', () => {
    expect(stageRange(5, 2)).toEqual([2, 3, 4, 5]);
  });

  it('clamps rather than throwing mid-stake', () => {
    expect(stageRange(0, 99)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('reads the way somebody would say it', () => {
    expect(stagesLabel([3])).toBe('Stage 3');
    expect(stagesLabel([1, 2, 3])).toBe('Stages 1 to 3');
    expect(stagesLabel([1, 2, 3, 4, 5, 6, 7])).toBe('All seven stages');
    // Not "1 to 6": that would claim four stages nobody has to fly.
    expect(stagesLabel([1, 4, 6])).toBe('Stages 1, 4, 6');
  });
});

describe('an entrant score', () => {
  it('is the mean of the stages entered', () => {
    const c = contest();
    expect(averageFor(c, entrant('a', { 1: 300, 2: 600, 3: 900 }))).toBe(600);
  });

  it('is null while stages are outstanding', () => {
    /*
     * The one that matters. A running mean of the stages flown so far would
     * put somebody who aced stage one above somebody who has finished all
     * three, on the strength of the two they have not attempted.
     */
    const c = contest();
    expect(averageFor(c, entrant('a', { 1: 9_000 }))).toBeNull();
  });

  it('counts a flown stage worth nothing as flown', () => {
    // Zero is a result. Treating it as absent would let a bad stage be hidden
    // by never finishing.
    const c = contest();
    expect(averageFor(c, entrant('a', { 1: 300, 2: 0, 3: 900 }))).toBe(400);
  });
});

describe('the table', () => {
  it('ranks the finished and lists the rest below', () => {
    const c = contest({
      entrants: [
        entrant('slow', { 1: 100 }),
        entrant('best', { 1: 900, 2: 900, 3: 900 }),
        entrant('mid', { 1: 400, 2: 400, 3: 400 }),
      ],
    });

    const rows = standings(c);
    expect(rows.map((r) => r.entrant.id)).toEqual(['best', 'mid', 'slow']);
    expect(rows[0]!.place).toBe(1);
    expect(rows[1]!.place).toBe(2);
    // No provisional position. They do not have one yet.
    expect(rows[2]!.place).toBe(0);
  });

  it('says how far through an unfinished entrant is', () => {
    const c = contest({ entrants: [entrant('slow', { 1: 100, 2: 100 })] });
    const row = standings(c)[0]!;

    expect(row.flown).toBe(2);
    expect(row.of).toBe(3);
  });

  it('does not let a leader be overtaken by somebody who stopped', () => {
    const c = contest({
      entrants: [entrant('quit', { 1: 9_000 }), entrant('done', { 1: 10, 2: 10, 3: 10 })],
    });

    expect(standings(c).map((r) => r.entrant.id)).toEqual(['done', 'quit']);
  });
});

describe('clan against clan', () => {
  it('scores on the mean, so turnout does not win it', () => {
    /*
     * The whole reason this is not a sum. WOLF turns up four deep and flies
     * badly; PACK sends two who fly well. On totals WOLF wins with nothing to
     * show for it and PACK cannot answer by playing better.
     */
    const c = contest({
      kind: 'clan',
      stages: [1],
      entrants: [
        entrant('w1', { 1: 100 }, 'WOLF'),
        entrant('w2', { 1: 100 }, 'WOLF'),
        entrant('w3', { 1: 100 }, 'WOLF'),
        entrant('w4', { 1: 100 }, 'WOLF'),
        entrant('p1', { 1: 500 }, 'PACK'),
        entrant('p2', { 1: 500 }, 'PACK'),
      ],
    });

    const rows = clanStandings(c);
    expect(rows[0]!.tag).toBe('PACK');
    expect(rows[0]!.average).toBe(500);
    expect(rows[1]!.average).toBe(100);
  });

  it('ignores members who have not finished', () => {
    // Otherwise quitting halfway would be an attack on your own clan.
    const c = contest({
      kind: 'clan',
      stages: [1, 2],
      entrants: [
        entrant('p1', { 1: 500, 2: 500 }, 'PACK'),
        entrant('p2', { 1: 0 }, 'PACK'),
      ],
    });

    const row = clanStandings(c)[0]!;
    expect(row.average).toBe(500);
    expect(row.finished).toBe(1);
    expect(row.entered).toBe(2);
  });

  it('gives no place to a clan where nobody has finished', () => {
    const c = contest({
      kind: 'clan',
      stages: [1, 2],
      entrants: [entrant('p1', { 1: 500 }, 'PACK')],
    });

    expect(clanStandings(c)[0]!.place).toBe(0);
  });
});

describe('taking a seat', () => {
  const me = { id: 'me', clanTag: 'PACK' };

  it('is allowed on an open contest with room', () => {
    expect(joinRefusal(contest(), me)).toBeNull();
    expect(seatsLeft(contest())).toBe(4);
  });

  it('refuses a second entry by the same pilot', () => {
    const c = contest({ entrants: [entrant('me', {})] });
    expect(joinRefusal(c, me)).toMatch(/already/i);
  });

  it('refuses a full contest', () => {
    const c = contest({ seats: 2, entrants: [entrant('a', {}), entrant('b', {})] });
    expect(seatsLeft(c)).toBe(0);
    expect(joinRefusal(c, me)).toMatch(/full/i);
  });

  it('refuses one that is over', () => {
    expect(joinRefusal(contest({ status: 'settled' }), me)).toMatch(/over/i);
  });

  it('tells a clanless pilot what to do rather than hiding the contest', () => {
    const c = contest({ kind: 'clan', clanTag: 'WOLF' });
    expect(joinRefusal(c, { id: 'me', clanTag: null })).toMatch(/join one/i);
  });

  it('refuses entering against your own clan', () => {
    const c = contest({ kind: 'clan', clanTag: 'PACK' });
    expect(joinRefusal(c, me)).toMatch(/own clan/i);
  });
});

describe('who owes whom', () => {
  /*
   * There is no escrow, so a settlement is a set of ordinary transfers between
   * two people at a time rather than a payout from a pot. The failures that
   * matter are quiet: a winner billed for their own contest, a quitter walking
   * away from a stake, or a clan settlement that hands one member everything.
   */
  it('is empty while it is still being flown', () => {
    const c = contest({ stakeNim: 5, entrants: [entrant('a', { 1: 5 })] });
    expect(obligationsOf(c)).toEqual([]);
  });

  it('is empty on a free contest', () => {
    // Nothing to pay and nothing to chase, which is most of why free is the
    // sane default when the app cannot enforce anything.
    const c = contest({
      stages: [1], status: 'settled', stakeNim: 0,
      entrants: [entrant('win', { 1: 900 }), entrant('lose', { 1: 100 })],
    });
    expect(obligationsOf(c)).toEqual([]);
  });

  it('bills every loser the stake, once, to the winner', () => {
    const c = contest({
      stages: [1], status: 'settled', stakeNim: 5,
      entrants: [entrant('win', { 1: 900 }), entrant('a', { 1: 300 }), entrant('b', { 1: 100 })],
    });

    const owed = obligationsOf(c);
    expect(owed).toHaveLength(2);
    expect(owed.every((o) => o.toId === 'win' && o.nim === 5)).toBe(true);
    // The winner is never billed for their own contest.
    expect(owed.some((o) => o.fromId === 'win')).toBe(false);
  });

  it('still bills somebody who walked away mid-contest', () => {
    // They agreed to the stake. Abandoning a run you are losing must not be a
    // way out of paying for it.
    const c = contest({
      stages: [1, 2], status: 'settled', stakeNim: 5,
      entrants: [entrant('win', { 1: 900, 2: 900 }), entrant('quit', { 1: 100 })],
    });

    expect(obligationsOf(c).map((o) => o.fromId)).toEqual(['quit']);
  });

  it('pairs clans by rank rather than paying one person everything', () => {
    /*
     * Paying the winning clan's owner would make one person a treasurer holding
     * everybody's winnings. Paying its top scorer would hand it all to one
     * member while their clanmates did the same work for nothing. So you pay
     * whoever actually beat you.
     */
    const c = contest({
      kind: 'clan', stages: [1], status: 'settled', stakeNim: 5,
      entrants: [
        entrant('w1', { 1: 900 }, 'WOLF'),
        entrant('w2', { 1: 700 }, 'WOLF'),
        entrant('p1', { 1: 400 }, 'PACK'),
        entrant('p2', { 1: 200 }, 'PACK'),
      ],
    });

    const owed = obligationsOf(c);
    expect(owed).toHaveLength(2);
    expect(owed.find((o) => o.fromId === 'p1')?.toId).toBe('w1');
    expect(owed.find((o) => o.fromId === 'p2')?.toId).toBe('w2');
  });

  it('sends an unmatched loser to whoever led the other side', () => {
    // Uneven rosters must not let the extra members owe nothing.
    const c = contest({
      kind: 'clan', stages: [1], status: 'settled', stakeNim: 5,
      entrants: [
        entrant('w1', { 1: 900 }, 'WOLF'),
        entrant('p1', { 1: 400 }, 'PACK'),
        entrant('p2', { 1: 200 }, 'PACK'),
      ],
    });

    const owed = obligationsOf(c);
    expect(owed).toHaveLength(2);
    expect(owed.every((o) => o.toId === 'w1')).toBe(true);
  });

  it('knows what one pilot still owes, and stops once they pay', () => {
    const base = {
      stages: [1], status: 'settled' as const, stakeNim: 5,
      entrants: [entrant('win', { 1: 900 }), entrant('lose', { 1: 100 })],
    };

    expect(debtOf(contest(base), 'lose')?.nim).toBe(5);
    expect(debtOf(contest(base), 'win')).toBeNull();
    // A reported payment clears it, which is what makes the reminder stop.
    expect(debtOf(contest({ ...base, paid: { lose: '0xabc' } }), 'lose')).toBeNull();
  });
});
