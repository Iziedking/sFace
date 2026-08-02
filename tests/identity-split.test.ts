/**
 * One player, two boards.
 *
 * The player is the same person on both chains: same name, same picture, same
 * clan, same friends. Switching to testnet is a setting, not a second account.
 *
 * What separates is the scoring, and it has to separate for a sharper reason
 * than tidiness. Testnet costs nothing to play, triggers no metered read, and
 * its NIM comes out of a faucet. `stagesCleared` feeds the assist tier, so if
 * campaign progress were shared, an unmetered grind on the free chain would buy
 * a measurably easier run on the real one. That is the purchasable advantage
 * this project refuses, arriving in a different currency.
 *
 * So: identity pooled, progress bucketed. These pin both halves.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import * as clans from '../server/clans';
import * as profiles from '../server/profiles';

/**
 * Fresh ids per case.
 *
 * The store is a module level map that lives for the whole file, so reusing an
 * id would let each case inherit the last one's totals and turn an assertion
 * about Face into arithmetic about test order.
 */
let seq = 0;
let PILOT = '';
let OTHER = '';

beforeEach(() => {
  seq++;
  PILOT = `aa${String(seq).padStart(2, '0')}`.padEnd(64, '0');
  OTHER = `bb${String(seq).padStart(2, '0')}`.padEnd(64, '0');
  clans.restore([]);
});

function play(
  id: string,
  network: string,
  face: number,
  extra: { name?: string; stage?: number; stageCleared?: boolean } = {},
) {
  profiles.record({
    id,
    name: extra.name ?? 'Pilot',
    network,
    score: face,
    rescued: 1,
    caches: 0,
    relics: 0,
    extracted: true,
    stage: extra.stage ?? 1,
    stageCleared: extra.stageCleared ?? false,
    avatarUrl: null,
  });
}

describe('one identity across both chains', () => {
  it('is the same person, whichever chain you ask about', () => {
    play(PILOT, 'main', 5_000, { name: 'Ada' });

    // Never flown on testnet, and still a real person there rather than a
    // stranger: the name is theirs, the totals are simply zero.
    const rehearsal = profiles.get(PILOT, 'test');
    expect(rehearsal?.name).toBe('Ada');
    expect(rehearsal?.lifetimeFace).toBe(0);
  });

  it('carries a clan across the switch', () => {
    const tag = clans.normaliseTag('WOLF')!;
    play(PILOT, 'main', 5_000);
    clans.join(PILOT, 'Ada', tag, Date.now());

    expect(profiles.get(PILOT, 'main')?.clanTag).toBe(tag);
    expect(profiles.get(PILOT, 'test')?.clanTag).toBe(tag);
  });
});

describe('progress does not cross chains', () => {
  it('keeps the two totals apart', () => {
    play(PILOT, 'main', 5_000);
    play(PILOT, 'test', 90_000);

    expect(profiles.get(PILOT, 'main')?.lifetimeFace).toBe(5_000);
    expect(profiles.get(PILOT, 'test')?.lifetimeFace).toBe(90_000);
  });

  it('does not let a testnet grind buy a mainnet assist tier', () => {
    /*
     * The one that actually matters. earnedAssist reads stagesCleared, so a
     * pooled campaign count is a free difficulty reduction on the paid chain.
     */
    play(PILOT, 'test', 100, { stage: 1, stageCleared: true });
    play(PILOT, 'test', 100, { stage: 2, stageCleared: true });

    expect(profiles.get(PILOT, 'test')?.stagesCleared).toBe(2);
    expect(profiles.get(PILOT, 'main')?.stagesCleared).toBe(0);
  });

  it('ranks each board on its own chain', () => {
    play(PILOT, 'main', 5_000);
    play(OTHER, 'test', 90_000);

    const live = profiles.allTime(50, 'main').map((p) => p.id);
    const rehearsal = profiles.allTime(50, 'test').map((p) => p.id);

    expect(live).toContain(PILOT);
    expect(live).not.toContain(OTHER);
    expect(rehearsal).toContain(OTHER);
    expect(rehearsal).not.toContain(PILOT);
  });

  it('folds two devices per chain when an account signs in', () => {
    // A phone that only ever flew testnet must not top up the real total.
    play(PILOT, 'test', 40_000);
    play(OTHER, 'main', 1_000);

    profiles.merge(PILOT, OTHER);

    expect(profiles.get(OTHER, 'main')?.lifetimeFace).toBe(1_000);
    expect(profiles.get(OTHER, 'test')?.lifetimeFace).toBe(40_000);
  });
});

describe('a clan is one clan', () => {
  it('cannot be founded twice by switching network', () => {
    const tag = clans.normaliseTag('PACK')!;

    expect(clans.join(PILOT, 'Ada', tag, Date.now()).status).toBe('founded');
    // Not "founded" again: the tag is taken, so the second pilot has to ask.
    expect(clans.join(OTHER, 'Bo', tag, Date.now()).status).toBe('requested');
  });

  it('shows the same roster on both chains', () => {
    const tag = clans.normaliseTag('HERD')!;
    play(PILOT, 'main', 5_000);
    clans.join(PILOT, 'Ada', tag, Date.now());

    expect(clans.detail(tag, 'main')?.members).toBe(1);
    expect(clans.detail(tag, 'test')?.members).toBe(1);
  });

  it('counts only the Face earned on the chain being shown', () => {
    const tag = clans.normaliseTag('CREW')!;
    play(PILOT, 'main', 5_000);
    play(OTHER, 'test', 90_000);
    clans.join(PILOT, 'Ada', tag, Date.now());
    clans.join(OTHER, 'Bo', tag, Date.now());
    clans.decide(tag, PILOT, OTHER, true);

    // Same two people in both places, and two different totals.
    expect(clans.detail(tag, 'main')?.members).toBe(2);
    expect(clans.detail(tag, 'test')?.members).toBe(2);
    expect(clans.detail(tag, 'main')?.face).toBe(5_000);
    expect(clans.detail(tag, 'test')?.face).toBe(90_000);
  });

  it('keeps its owner through a restart', () => {
    const tag = clans.normaliseTag('KIN')!;
    clans.join(PILOT, 'Ada', tag, Date.now());

    clans.restore(clans.serialise());

    expect(clans.detail(tag, 'main')?.ownerId).toBe(PILOT);
    expect(clans.detail(tag, 'test')?.ownerId).toBe(PILOT);
  });
});

describe('older snapshots load', () => {
  it('reads a flat record with no network as mainnet', () => {
    /*
     * The shape written before progress was bucketed. Reading it as anything
     * other than mainnet would quietly demote real Face to a rehearsal.
     */
    profiles.restore([
      { id: PILOT, name: 'Ada', lifetimeFace: 7_500, bestScore: 900, stagesCleared: 3 },
    ]);

    expect(profiles.get(PILOT, 'main')?.lifetimeFace).toBe(7_500);
    expect(profiles.get(PILOT, 'main')?.stagesCleared).toBe(3);
    expect(profiles.get(PILOT, 'test')?.lifetimeFace).toBe(0);
  });

  it('honours a flat record that says it was testnet', () => {
    // Written during the short window the two were separate identities.
    profiles.restore([{ id: PILOT, name: 'Ada', network: 'test', lifetimeFace: 7_500 }]);

    expect(profiles.get(PILOT, 'test')?.lifetimeFace).toBe(7_500);
    expect(profiles.get(PILOT, 'main')?.lifetimeFace).toBe(0);
  });

  it('round-trips the bucketed shape', () => {
    play(PILOT, 'main', 5_000);
    play(PILOT, 'test', 90_000);

    profiles.restore(profiles.serialise() as unknown[]);

    expect(profiles.get(PILOT, 'main')?.lifetimeFace).toBe(5_000);
    expect(profiles.get(PILOT, 'test')?.lifetimeFace).toBe(90_000);
  });
});

describe('a clan holds seven', () => {
  /*
   * A design decision, not a technical limit. A clan is meant to be the group
   * chat you already have, so the cap sits where a group stops being people who
   * know each other. It also keeps a clan contest honest: the mean of seven is
   * an average of a squad, the mean of two hundred is a statistic.
   */
  function member(n: number): string {
    return `m${String(n).padStart(2, '0')}`.padEnd(64, '0');
  }

  function fill(tag: string, count: number): void {
    clans.join(member(0), 'Owner', tag, Date.now());
    for (let i = 1; i < count; i++) {
      clans.join(member(i), `Pilot ${i}`, tag, Date.now());
      clans.decide(tag, member(0), member(i), true);
    }
  }

  it('takes the seventh and refuses the eighth', () => {
    const tag = clans.normaliseTag('FULL')!;
    fill(tag, clans.MAX_MEMBERS);

    expect(clans.sizeOf(tag)).toBe(clans.MAX_MEMBERS);
    expect(clans.join(member(99), 'Late', tag, Date.now()).status).toBe('refused');
  });

  it('refuses a request that outlived the room it was made for', () => {
    /*
     * Seven ask, the owner approves one at a time, and the last few would walk
     * into a clan that filled while they were waiting. Checked again at the
     * decision, not only at the door.
     */
    const tag = clans.normaliseTag('RACE')!;
    clans.join(member(0), 'Owner', tag, Date.now());

    for (let i = 1; i <= 7; i++) clans.join(member(i), `Pilot ${i}`, tag, Date.now());

    let approved = 1;
    for (let i = 1; i <= 7; i++) {
      if (clans.decide(tag, member(0), member(i), true).ok) approved++;
    }

    expect(approved).toBe(clans.MAX_MEMBERS);
    expect(clans.sizeOf(tag)).toBe(clans.MAX_MEMBERS);
  });
});

describe('the wallet behind a pilot', () => {
  /*
   * The all-time board ranks on lifetime Face, which is the sum of dozens of
   * runs, so no signature covers the number on a row. Binding the address that
   * proved a run is the weaker claim the ladder can still make honestly.
   */
  it('follows the pilot across chains, because a wallet is identity', () => {
    const addr = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000';
    play(PILOT, 'main', 5_000);
    profiles.bindAddress(PILOT, addr);

    expect(profiles.get(PILOT, 'main')?.address).toBe(addr);
    expect(profiles.get(PILOT, 'test')?.address).toBe(addr);
  });

  it('is absent until a run has actually been signed', () => {
    // A pilot who has never proved anything must not carry a mark.
    play(PILOT, 'main', 5_000);
    expect(profiles.get(PILOT, 'main')?.address).toBeNull();
  });

  it('does nothing for a pilot who does not exist', () => {
    expect(() => profiles.bindAddress('nobody', 'NQ07 0000')).not.toThrow();
  });

  it('takes the newer wallet when somebody changes one', () => {
    play(PILOT, 'main', 5_000);
    profiles.bindAddress(PILOT, 'NQ07 AAAA');
    profiles.bindAddress(PILOT, 'NQ07 BBBB');

    expect(profiles.get(PILOT, 'main')?.address).toBe('NQ07 BBBB');
  });

  it('survives a restart', () => {
    play(PILOT, 'main', 5_000);
    profiles.bindAddress(PILOT, 'NQ07 CCCC');

    profiles.restore(profiles.serialise() as unknown[]);

    expect(profiles.get(PILOT, 'main')?.address).toBe('NQ07 CCCC');
  });

  it('keeps a binding when two devices are merged', () => {
    // Somebody who signed on their phone before connecting X on a laptop.
    play(PILOT, 'main', 5_000);
    play(OTHER, 'main', 1_000);
    profiles.bindAddress(PILOT, 'NQ07 DDDD');

    profiles.merge(PILOT, OTHER);

    expect(profiles.get(OTHER, 'main')?.address).toBe('NQ07 DDDD');
  });
});
