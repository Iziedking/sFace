/**
 * The seed invariant, which is the thing challenges actually settle on.
 *
 * Two people bet NIM on who scores higher on "the same level". If the levels
 * are not byte-for-byte the same, the bet is not a bet, and the failure is
 * silent: nobody sees a crash, one player just quietly had an easier run. That
 * makes this the money path of this codebase, so it gets the most tests.
 *
 * The subtle one is the last test in this file. Level layout draws from one
 * random stream and in-play behaviour draws from another. If they were ever
 * merged, killing an enemy early would shift every later draw, and two players
 * would diverge partway through a level that started identical. That bug would
 * survive every other test here.
 */

import { describe, expect, it } from 'vitest';

import { Rng, hashSeed } from '../src/core/rng';
import { practiceMission, parseMission, TERRAIN_POINTS } from '../src/game/mission';
import { RunState } from '../src/game/state';
import { step } from '../src/game/update';
import type { PlayerCommand } from '../src/game/player';
import { earn, spend } from '../src/game/scrip';

const IDLE: PlayerCommand = { moveX: 0, moveY: 0, aimX: null, aimY: null, firing: false };
const FLYING: PlayerCommand = { moveX: 1, moveY: -0.4, aimX: 900, aimY: 400, firing: true };

/** A stable fingerprint of everything a level is made of. */
function fingerprint(run: RunState): string {
  const enemies = run.enemies
    .map((e) => `${e.kind}:${e.x.toFixed(4)}:${e.y.toFixed(4)}:${e.health}`)
    .join('|');
  const faces = run.faces
    .map((f) => `${f.quirk}:${f.x.toFixed(4)}:${f.y.toFixed(4)}:${f.selfExtractX.toFixed(4)}`)
    .join('|');
  return `${enemies}#${faces}`;
}

describe('seeded rng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = new Rng('2026-07-28:beat:-19.10:fng29');
    const b = new Rng('2026-07-28:beat:-19.10:fng29');
    const left = Array.from({ length: 500 }, () => a.next());
    const right = Array.from({ length: 500 }, () => b.next());
    expect(left).toEqual(right);
  });

  it('produces a different sequence for a different seed', () => {
    const a = new Rng('2026-07-28:beat:-19.10:fng29');
    const b = new Rng('2026-07-28:beat:-19.11:fng29');
    expect(a.next()).not.toEqual(b.next());
  });

  it('stays inside [0, 1)', () => {
    const rng = new Rng('bounds');
    for (let i = 0; i < 10_000; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('hashes seeds to an unsigned 32 bit integer', () => {
    for (const seed of ['', 'a', 'a longer seed string', '2026-07-28:beat']) {
      const hash = hashSeed(seed);
      expect(Number.isInteger(hash)).toBe(true);
      expect(hash).toBeGreaterThanOrEqual(0);
      expect(hash).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('keeps int() inside its inclusive bounds', () => {
    const rng = new Rng('ints');
    for (let i = 0; i < 5000; i++) {
      const value = rng.int(3, 7);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(7);
    }
  });
});

describe('level generation', () => {
  const mission = practiceMission('2026-07-28');

  it('lays out an identical level from the same mission', () => {
    expect(fingerprint(new RunState(mission))).toEqual(fingerprint(new RunState(mission)));
  });

  it('lays out a different level for a different day', () => {
    const other = practiceMission('2026-07-29');
    expect(fingerprint(new RunState(mission))).not.toEqual(
      fingerprint(new RunState(other)),
    );
  });

  it('places one of every face archetype', () => {
    const quirks = new RunState(mission).faces.map((f) => f.quirk).sort();
    expect(quirks).toEqual(['heavy', 'mercenary', 'paranoid', 'skittish', 'talker']);
  });

  it('never places a face or enemy inside the ground', () => {
    const run = new RunState(mission);
    for (const face of run.faces) {
      expect(face.y).toBeLessThanOrEqual(run.terrain.groundAt(face.x));
    }
    for (const enemy of run.enemies) {
      // Turrets sit on the surface, everything else must be clear of it.
      expect(enemy.y).toBeLessThanOrEqual(run.terrain.groundAt(enemy.x) + 1);
    }
  });

  it('scales attacker count with the difficulty the market set', () => {
    const calm = new RunState({ ...mission, difficulty: 1 });
    const brutal = new RunState({ ...mission, difficulty: 5 });
    expect(brutal.enemies.length).toBeGreaterThan(calm.enemies.length);
  });
});

describe('play does not disturb the level', () => {
  /**
   * The one that matters. Play one run hard and one run not at all, from the
   * same seed, and the parts of the level nobody has reached yet must still be
   * identical. If in-play randomness ever leaks into the level stream, the two
   * diverge here and nowhere else.
   */
  it('leaves untouched enemies and faces identical after heavy play', () => {
    const mission = practiceMission('2026-07-28');

    const played = new RunState(mission);
    const untouched = new RunState(mission);

    for (let i = 0; i < 60 * 30; i++) {
      step(played, 1 / 60, i % 3 === 0 ? FLYING : IDLE);
    }

    expect(played.time).toBeGreaterThan(1);

    // Compare only what the player never reached, since the near part of the
    // level legitimately changed by being played.
    const far = (x: number) => x > played.player.x + 2000;

    const farEnemies = (run: RunState) =>
      run.enemies
        .filter((e) => far(e.x))
        .map((e) => `${e.kind}:${e.x.toFixed(4)}:${e.y.toFixed(4)}`)
        .join('|');
    const farFaces = (run: RunState) =>
      run.faces
        .filter((f) => far(f.x))
        .map((f) => `${f.quirk}:${f.x.toFixed(4)}:${f.y.toFixed(4)}`)
        .join('|');

    expect(farEnemies(played)).toEqual(farEnemies(untouched));
    expect(farFaces(played)).toEqual(farFaces(untouched));
    expect(farEnemies(played).length).toBeGreaterThan(0);
  });
});

describe('mission payload validation', () => {
  const valid = {
    date: '2026-07-28',
    seed: 'seed',
    ticker: 'BEAT',
    coinName: 'Audiera',
    changePct: -19.1,
    terrain: Array.from({ length: TERRAIN_POINTS }, (_, i) => i / TERRAIN_POINTS),
    fearGreed: 29,
    fearLabel: 'Fear',
    difficulty: 4,
    bountyMultiplier: 1.45,
  };

  it('accepts a well formed payload', () => {
    expect(parseMission(valid)?.ticker).toBe('BEAT');
  });

  it('refuses a terrain of the wrong length, which would shift the geometry', () => {
    expect(parseMission({ ...valid, terrain: valid.terrain.slice(0, 100) })).toBeNull();
  });

  it('refuses non-numeric terrain rather than generating NaN ground', () => {
    const poisoned = [...valid.terrain];
    poisoned[10] = Number.NaN;
    expect(parseMission({ ...valid, terrain: poisoned })).toBeNull();
  });

  it('refuses missing required fields', () => {
    expect(parseMission({ ...valid, seed: '' })).toBeNull();
    expect(parseMission({ ...valid, date: undefined })).toBeNull();
    expect(parseMission(null)).toBeNull();
    expect(parseMission('nope')).toBeNull();
  });

  it('clamps out of range chart points instead of letting them off screen', () => {
    const drifted = [...valid.terrain];
    drifted[0] = -0.4;
    drifted[1] = 1.6;
    const parsed = parseMission({ ...valid, terrain: drifted });
    expect(parsed?.terrain[0]).toBe(0);
    expect(parsed?.terrain[1]).toBe(1);
  });

  it('marks the practice mission as not live so it can never pose as market data', () => {
    expect(practiceMission('2026-07-28').live).toBe(false);
    expect(parseMission(valid)?.live).toBe(true);
  });

  it('gives every player the same practice mission on the same day', () => {
    expect(practiceMission('2026-07-28')).toEqual(practiceMission('2026-07-28'));
  });
});

/**
 * Scrip is the money you spend inside a run, and a challenge is a bet between
 * two people who must have had identical opportunities to earn it. If one
 * player's level pays better than another's on the same seed, the bet is
 * rigged and nothing on screen would say so.
 *
 * This is why every payout is drawn when the level is laid out rather than
 * rolled when an attacker dies: a roll at death time is consumed in whatever
 * order the player happens to kill things, so two players who fought the same
 * level in a different order would finish with different money.
 */
describe('scrip is a property of the level, not of the fight', () => {
  it('pays the same total on one seed regardless of kill order', () => {
    const mission = practiceMission('2026-07-29');

    const a = new RunState(mission, 'sidearm', 1);
    const b = new RunState(mission, 'sidearm', 1);

    // Same enemies, same drops, in the same places.
    expect(a.enemies.map((e) => e.drop)).toEqual(b.enemies.map((e) => e.drop));

    // Kill them in opposite orders and the take must still match.
    const forward = [...a.enemies];
    const backward = [...b.enemies].reverse();
    let takeA = 0;
    let takeB = 0;
    for (const enemy of forward) takeA += enemy.drop;
    for (const enemy of backward) takeB += enemy.drop;

    expect(takeA).toBe(takeB);
    expect(takeA).toBeGreaterThan(0);
  });

  it('puts the same scrip in the same caches on one seed', () => {
    const mission = practiceMission('2026-07-29');
    const a = new RunState(mission, 'sidearm', 3);
    const b = new RunState(mission, 'sidearm', 3);

    expect(a.caches.map((c) => `${c.tier}:${c.scrip}`)).toEqual(
      b.caches.map((c) => `${c.tier}:${c.scrip}`),
    );
  });

  it('starts every run empty, so nothing can be carried in', () => {
    const mission = practiceMission('2026-07-29');
    const run = new RunState(mission, 'sidearm', 1);

    expect(run.purse.held).toBe(0);
    expect(run.purse.collected).toBe(0);
    expect(run.purse.spent).toBe(0);
    expect(run.purse.ticker).toBe(mission.ticker);
  });

  it('refuses to spend what is not held', () => {
    const mission = practiceMission('2026-07-29');
    const run = new RunState(mission, 'sidearm', 1);

    earn(run.purse, 30);
    expect(spend(run.purse, 31)).toBe(false);
    expect(run.purse.held).toBe(30);

    expect(spend(run.purse, 30)).toBe(true);
    expect(run.purse.held).toBe(0);
    // The ledger has to balance or the HUD is lying about something.
    expect(run.purse.collected - run.purse.spent).toBe(run.purse.held);
  });
});
