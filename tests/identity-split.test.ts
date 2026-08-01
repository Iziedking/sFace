/**
 * Testnet and mainnet are two different people.
 *
 * Testnet NIM comes out of a faucet. If the two chains shared an identity then
 * Face farmed for nothing would carry a rank badge onto the real board, and
 * separating the boards would be half a wall: different tables, same player,
 * same lifetime total, same rank.
 *
 * The pilot id is scoped on the client, so profiles, challenges and ghosts
 * separate on their own. A clan tag does not: WOLF is the same four characters
 * on both chains. These pin the parts that needed the server to know.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import * as clans from '../server/clans';
import * as profiles from '../server/profiles';

/**
 * Fresh ids per case.
 *
 * The profile store is a module level map that lives for the whole file, so
 * reusing one id would let each case inherit the last one's lifetime Face and
 * turn an assertion about clan totals into arithmetic about test order.
 */
let seq = 0;
let LIVE = '';
let TEST = '';

beforeEach(() => {
  seq++;
  LIVE = `live${String(seq).padStart(2, '0')}`.padEnd(64, '0');
  TEST = `test${String(seq).padStart(2, '0')}`.padEnd(64, '0');
});

function play(id: string, network: string, face: number, name = 'Pilot') {
  profiles.record({
    id,
    name,
    network,
    score: face,
    rescued: 1,
    caches: 0,
    relics: 0,
    extracted: true,
    stage: 1,
    stageCleared: false,
    avatarUrl: null,
  });
}

describe('the all-time board', () => {
  it('shows only the chain being asked about', () => {
    play(LIVE, 'main', 5_000);
    play(TEST, 'test', 90_000);

    const live = profiles.allTime(50, 'main').map((p) => p.id);
    const rehearsal = profiles.allTime(50, 'test').map((p) => p.id);

    expect(live).toContain(LIVE);
    expect(live).not.toContain(TEST);
    expect(rehearsal).toContain(TEST);
    expect(rehearsal).not.toContain(LIVE);
  });
});

describe('a clan tag on both chains is two clans', () => {
  beforeEach(() => {
    clans.restore([]);
  });

  it('lets each chain own the same tag independently', () => {
    const tag = clans.normaliseTag('WOLF')!;

    expect(clans.join(LIVE, 'Live', tag, Date.now(), 'main').status).toBe('founded');
    // Founded again, not "requested": on testnet nobody has taken it.
    expect(clans.join(TEST, 'Test', tag, Date.now(), 'test').status).toBe('founded');
  });

  it('does not pool the two rosters into one row', () => {
    /*
     * The failure this catches is silent and flattering: a clan that looks
     * twice its size with a Face total nobody earned on the chain being shown.
     */
    const tag = clans.normaliseTag('PACK')!;

    play(LIVE, 'main', 5_000);
    play(TEST, 'test', 90_000);
    clans.join(LIVE, 'Live', tag, Date.now(), 'main');
    clans.join(TEST, 'Test', tag, Date.now(), 'test');

    const live = clans.detail(tag, 'main');
    const rehearsal = clans.detail(tag, 'test');

    expect(live?.members).toBe(1);
    expect(rehearsal?.members).toBe(1);
    expect(live?.face).toBe(5_000);
    expect(rehearsal?.face).toBe(90_000);
  });

  it('keeps the owner of one off the other', () => {
    const tag = clans.normaliseTag('HERD')!;
    clans.join(LIVE, 'Live', tag, Date.now(), 'main');
    clans.join(TEST, 'Test', tag, Date.now(), 'test');

    expect(clans.detail(tag, 'main')?.ownerId).toBe(LIVE);
    expect(clans.detail(tag, 'test')?.ownerId).toBe(TEST);
  });

  it('survives a restart with both chains intact', () => {
    // restore used to rebuild every clan onto one key, which is this whole
    // change undone on the next deploy.
    const tag = clans.normaliseTag('CREW')!;
    clans.join(LIVE, 'Live', tag, Date.now(), 'main');
    clans.join(TEST, 'Test', tag, Date.now(), 'test');

    clans.restore(clans.serialise());

    expect(clans.detail(tag, 'main')?.ownerId).toBe(LIVE);
    expect(clans.detail(tag, 'test')?.ownerId).toBe(TEST);
  });

  it('reads a clan saved before the split as mainnet', () => {
    clans.restore([{ tag: 'OLDS', ownerId: LIVE, createdAt: 1, pending: [] }]);

    expect(clans.detail('OLDS', 'main')?.ownerId).toBe(LIVE);
    expect(clans.detail('OLDS', 'test')).toBeNull();
  });
});
