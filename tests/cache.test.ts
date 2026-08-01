/**
 * Caches, and the two properties that make them worth having.
 *
 * **They are off the optimal line.** If a cache can be collected by flying the
 * comfortable altitude in a straight line, it is not treasure, it is a
 * participation trophy, and the game goes back to having no way to tell a good
 * pilot from a lucky one.
 *
 * **They are in the same place for everyone on a seed.** Two people betting
 * NIM on the same mission must be able to find the same relic in the same
 * trough, or the bet is not a bet.
 *
 * The relic test is the one to protect. It sits at the single lowest point of
 * the day's chart, which is the worst moment of that day's market, and that is
 * the whole reason the mechanic means anything.
 */

import { describe, expect, it } from 'vitest';

import { practiceMission } from '../src/game/mission';
import { RunState } from '../src/game/state';
import { step } from '../src/game/update';
import { POINT_SPACING, CEILING } from '../src/game/terrain';
import { PLAYER_RADIUS, type PlayerCommand } from '../src/game/player';
import { cacheFace, cacheReach } from '../src/game/cache';
import { CACHES } from '../src/data/story';

const DT = 1 / 60;
const IDLE: PlayerCommand = { moveX: 0, moveY: 0, aimX: null, aimY: null, firing: false };

function mission() {
  return practiceMission('2026-07-28');
}

/** The altitude an unadventurous pilot holds. */
const COMFORT = 200;

describe('cache placement', () => {
  it('puts the relic at the lowest point of the day chart', () => {
    /*
     * Chart stages only.
     *
     * Stage seven used to be in this list, on the reasoning that it flies the
     * whole chart and so has its relic at the true global bottom. It does not
     * fly a chart at all: it is a ring world, and the chart position was only
     * still there because the ring relocation never moved caches. That left the
     * eight caches the stage needs to clear scattered across a strip of a world
     * nobody is standing in. Its relic is checked in the ring case below.
     */
    for (const stage of [1, 4]) {
      const run = new RunState(mission(), 'sidearm', stage);
      const relic = run.caches.find((c) => c.tier === 'relic');
      expect(relic).toBeDefined();

      // The deepest sample inside the stretch this stage actually flies.
      // Highest y is lowest price.
      let deepestY = -Infinity;
      let deepestX = 0;
      for (let i = 1; i < run.terrain.heights.length - 1; i++) {
        const x = i * POINT_SPACING;
        if (x < 900 || x > run.extractionX - 300) continue;
        const y = run.terrain.heights[i] ?? -Infinity;
        if (y > deepestY) {
          deepestY = y;
          deepestX = x;
        }
      }

      // Within one chart sample of that bottom.
      expect(Math.abs(relic!.x - deepestX)).toBeLessThanOrEqual(POINT_SPACING);
    }
  });

  it('moves every cache into the rings on the finale', () => {
    /*
     * The bug this replaced was quiet and expensive. Stage seven asks for eight
     * caches to clear, the ring block relocated allies, enemies and faces but
     * never caches, and the layout functions place against a ground line, so
     * they sat in a thin strip of the old chart. A run could finish having found
     * five, which is what a player reported, and reads as the stage being
     * unfairly hard rather than as a placement fault.
     */
    const run = new RunState(mission(), 'sidearm', 7);
    const rings = run.rings;
    expect(rings).not.toBeNull();

    const cx = rings!.cx;
    const cy = rings!.cy;

    for (const cache of run.caches) {
      const reach = Math.hypot(cache.x - cx, cache.y - cy);
      // Inside the outermost wall, so it is somewhere the player can work to.
      expect(reach).toBeLessThanOrEqual(rings!.width / 2);
      expect(cache.x).toBeGreaterThanOrEqual(0);
      expect(cache.y).toBeGreaterThanOrEqual(0);
    }
  });

  it('moves the hull refills in with them', () => {
    // Refills were laid out after the ring block ran, so they were the one thing
    // it could not have relocated even if it had mentioned them.
    const run = new RunState(mission(), 'sidearm', 7);
    const rings = run.rings!;

    for (const refill of run.refills) {
      const reach = Math.hypot(refill.x - rings.cx, refill.y - rings.cy);
      expect(reach).toBeLessThanOrEqual(rings.width / 2);
    }
  });

  it('places exactly one relic', () => {
    const run = new RunState(mission());
    expect(run.caches.filter((c) => c.tier === 'relic')).toHaveLength(1);
  });

  it('keeps every cache inside the world and clear of the ground', () => {
    const run = new RunState(mission());
    expect(run.caches.length).toBeGreaterThan(4);

    for (const cache of run.caches) {
      expect(cache.y).toBeGreaterThanOrEqual(CEILING);
      expect(cache.y).toBeLessThanOrEqual(run.terrain.groundAt(cache.x));
    }
  });

  /**
   * The one that justifies the whole feature. Fly the comfortable line from
   * one end of the level to the other and you should collect almost nothing.
   */
  it('cannot be collected by flying the comfortable line', () => {
    const run = new RunState(mission());

    let reachable = 0;
    for (const cache of run.caches) {
      const comfortable = run.terrain.groundAt(cache.x) - COMFORT;
      const gap = Math.abs(cache.y - comfortable);
      if (gap <= cacheReach(cache.tier) + PLAYER_RADIUS) reachable++;
    }

    expect(reachable).toBe(0);
  });

  it('lays out identically for two players on the same seed', () => {
    const print = (run: RunState) =>
      run.caches.map((c) => `${c.tier}:${c.x.toFixed(4)}:${c.y.toFixed(4)}`).join('|');

    expect(print(new RunState(mission()))).toEqual(print(new RunState(mission())));
  });

  it('lays out differently on a different day', () => {
    const print = (run: RunState) =>
      run.caches.map((c) => `${c.tier}:${c.x.toFixed(4)}:${c.y.toFixed(4)}`).join('|');

    expect(print(new RunState(practiceMission('2026-07-28')))).not.toEqual(
      print(new RunState(practiceMission('2026-07-29'))),
    );
  });

  it('pays more the harder a tier is to reach', () => {
    expect(cacheFace('vault')).toBeGreaterThan(cacheFace('sealed'));
    expect(cacheFace('relic')).toBeGreaterThan(cacheFace('vault'));
    // And the rarer ones have a tighter pickup, so they have to be meant.
    expect(CACHES.relic.reach).toBeLessThan(CACHES.sealed.reach);
  });
});

describe('collecting', () => {
  it('banks the Face on contact and marks it taken', () => {
    const run = new RunState(mission());
    const cache = run.caches.find((c) => c.tier === 'sealed')!;

    run.player.x = cache.x;
    run.player.y = cache.y;
    step(run, DT, IDLE);

    expect(cache.taken).toBe(true);
    expect(run.cachesTaken).toBe(1);
    expect(run.cacheScore).toBe(cacheFace('sealed'));
  });

  it('cannot be collected twice', () => {
    const run = new RunState(mission());
    const cache = run.caches.find((c) => c.tier === 'sealed')!;

    run.player.x = cache.x;
    run.player.y = cache.y;
    for (let i = 0; i < 10; i++) step(run, DT, IDLE);

    expect(run.cachesTaken).toBe(1);
    expect(run.cacheScore).toBe(cacheFace('sealed'));
  });

  it('records the relic separately, because it is once a day', () => {
    const run = new RunState(mission());
    const relic = run.caches.find((c) => c.tier === 'relic')!;

    expect(run.relicTaken).toBe(false);
    run.player.x = relic.x;
    run.player.y = relic.y;
    step(run, DT, IDLE);

    expect(run.relicTaken).toBe(true);
  });

  /**
   * A cache is out of the ground the moment you touch it. Dying costs you the
   * extraction half of your rescues and nothing here, so a deep dive is a
   * gamble on your hull rather than a gamble on the reward.
   */
  it('keeps recovered Face when the run ends badly', () => {
    const run = new RunState(mission());
    const cache = run.caches.find((c) => c.tier === 'sealed')!;

    run.player.x = cache.x;
    run.player.y = cache.y;
    step(run, DT, IDLE);
    const banked = run.cacheScore;
    expect(banked).toBeGreaterThan(0);

    run.player.invulnerableUntil = 0;
    run.player.health = 0;
    step(run, DT, IDLE);

    expect(run.phase).toBe('died');
    expect(run.cacheScore).toBe(banked);
    expect(run.score).toBeGreaterThan(0);
  });

  it('counts toward the run score through the market bounty', () => {
    const plain = new RunState({ ...mission(), bountyMultiplier: 1 });
    const boosted = new RunState({ ...mission(), bountyMultiplier: 2 });

    for (const run of [plain, boosted]) {
      const cache = run.caches.find((c) => c.tier === 'vault' || c.tier === 'sealed')!;
      run.player.x = cache.x;
      run.player.y = cache.y;
      step(run, DT, IDLE);
    }

    expect(boosted.score).toBe(plain.score * 2);
  });
});
