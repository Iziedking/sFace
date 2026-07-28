/**
 * The rack, and the rule it exists under.
 *
 * The load-bearing tests here are the two in `the fair bet`. sFace lets people
 * stake real NIM on beating a score on a shared seed, and that is only honest
 * while both sides are flying the same game. A weapon is allowed to change the
 * shape of a run and is not allowed to change the level or to be strictly
 * better than the one everybody starts with.
 *
 * If either of those tests fails, the correct response is to fix the weapon,
 * not the test.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_WEAPON,
  WEAPONS,
  isUnlocked,
  nextUnlock,
  reachOf,
  sustainedDamage,
  unlockedWeapons,
  weaponById,
} from '../src/data/weapons';
import { practiceMission } from '../src/game/mission';
import { RunState } from '../src/game/state';
import { step } from '../src/game/update';
import type { PlayerCommand } from '../src/game/player';

const DT = 1 / 60;

function mission() {
  return practiceMission('2026-07-28');
}

const FIRING: PlayerCommand = { moveX: 0, moveY: 0, aimX: null, aimY: null, firing: true };

describe('the fair bet', () => {
  /**
   * Every gun must lay out an identical level. Nothing in the level generator
   * reads the weapon today; this is here so that if somebody ever wires one in,
   * they find out immediately rather than after a challenge settles wrong.
   */
  it('lays out the same level whatever is in hand', () => {
    const print = (run: RunState) =>
      [
        run.enemies.map((e) => `${e.kind}:${e.x.toFixed(4)}:${e.y.toFixed(4)}:${e.health}`).join('|'),
        run.faces.map((f) => `${f.handle}:${f.x.toFixed(4)}:${f.y.toFixed(4)}`).join('|'),
        run.caches.map((c) => `${c.tier}:${c.x.toFixed(4)}:${c.y.toFixed(4)}`).join('|'),
        run.refills.map((r) => `${r.x.toFixed(4)}:${r.y.toFixed(4)}`).join('|'),
      ].join('\n');

    const baseline = print(new RunState(mission(), DEFAULT_WEAPON));
    for (const weapon of WEAPONS) {
      expect(print(new RunState(mission(), weapon.id))).toEqual(baseline);
    }
  });

  /**
   * No unlock may be a straight upgrade. Sustained damage stays inside a narrow
   * band, and anything that out-damages the sidearm has to give up reach for it.
   */
  it('keeps every unlock a sidegrade rather than an upgrade', () => {
    const sidearm = weaponById(DEFAULT_WEAPON);

    for (const weapon of WEAPONS) {
      expect(sustainedDamage(weapon)).toBeGreaterThanOrEqual(75);
      expect(sustainedDamage(weapon)).toBeLessThanOrEqual(115);

      if (weapon.id === sidearm.id) continue;

      // Out-damaging the default is allowed. Out-damaging it while also
      // out-ranging it is not, because that is the definition of strictly
      // better and it is what would make a full rack an advantage.
      const harder = sustainedDamage(weapon) > sustainedDamage(sidearm);
      const further = reachOf(weapon) > reachOf(sidearm);
      expect(harder && further).toBe(false);
    }
  });

  it('states a cost for every single one', () => {
    for (const weapon of WEAPONS) {
      expect(weapon.cost.length).toBeGreaterThan(10);
      expect(weapon.blurb.length).toBeGreaterThan(10);
    }
  });
});

describe('unlocks', () => {
  it('gives a brand new pilot exactly one gun, and it is the default', () => {
    const rack = unlockedWeapons(0);
    expect(rack).toHaveLength(1);
    expect(rack[0]?.id).toBe(DEFAULT_WEAPON);
  });

  it('opens the rack as lifetime Face accumulates', () => {
    expect(unlockedWeapons(4_999)).toHaveLength(1);
    expect(unlockedWeapons(5_000)).toHaveLength(2);
    expect(unlockedWeapons(1_000_000)).toHaveLength(WEAPONS.length);
  });

  /** Face, never NIM. Nothing in the rack carries a price. */
  it('costs Face and nothing else', () => {
    for (const weapon of WEAPONS) {
      expect(Number.isFinite(weapon.unlockAt)).toBe(true);
      expect(weapon.unlockAt).toBeGreaterThanOrEqual(0);
      expect(weapon).not.toHaveProperty('priceNim');
    }
  });

  it('refuses a negative or nonsense record without throwing', () => {
    expect(unlockedWeapons(-500)).toHaveLength(1);
    expect(isUnlocked(weaponById('lance'), -1)).toBe(false);
    expect(weaponById('not-a-gun').id).toBe(DEFAULT_WEAPON);
    expect(weaponById(null).id).toBe(DEFAULT_WEAPON);
  });

  it('always has something left to aim at until the rack is full', () => {
    expect(nextUnlock(0)?.weapon.id).toBe('scatter');
    expect(nextUnlock(0)?.remaining).toBe(5_000);
    expect(nextUnlock(1_000_000)).toBeNull();
  });
});

describe('firing', () => {
  /** Park the ship in open air, hold the trigger for one frame, count rounds. */
  function onePull(weaponId: string): RunState {
    const run = new RunState(mission(), weaponId as never);
    run.player.x = 600;
    run.player.y = run.terrain.groundAt(600) - 260;
    run.player.fireCooldown = 0;
    step(run, DT, FIRING);
    return run;
  }

  it('puts one round in the air for a single-round gun', () => {
    expect(onePull('sidearm').bullets.filter((b) => b.friendly)).toHaveLength(1);
  });

  it('fans a scattergun into three, spread around the aim', () => {
    const shots = onePull('scatter').bullets.filter((b) => b.friendly);
    expect(shots).toHaveLength(3);

    const angles = shots.map((b) => Math.atan2(b.vy, b.vx)).sort((a, b) => a - b);
    const weapon = weaponById('scatter');

    // Three distinct headings, spanning the stated fan and centred on the
    // middle pellet. The tolerance is loose because a round inherits a share
    // of the ship's own velocity, and the ship is always falling a little.
    expect(angles[0]).toBeLessThan(angles[1]!);
    expect(angles[1]).toBeLessThan(angles[2]!);
    expect(angles[2]! - angles[0]!).toBeCloseTo(weapon.spread * 2, 2);
    expect((angles[0]! + angles[2]!) / 2).toBeCloseTo(angles[1]!, 2);
  });

  /**
   * The fan is fixed, not random. Two identical pulls must produce identical
   * headings, or closing the distance is a dice roll instead of a decision.
   */
  it('fans the same way every time', () => {
    const print = (run: RunState) =>
      run.bullets
        .filter((b) => b.friendly)
        .map((b) => Math.atan2(b.vy, b.vx).toFixed(8))
        .join('|');

    expect(print(onePull('scatter'))).toEqual(print(onePull('scatter')));
  });

  it('carries the weapon damage rather than a shared constant', () => {
    for (const weapon of WEAPONS) {
      const shot = onePull(weapon.id).bullets.find((b) => b.friendly);
      expect(shot?.damage).toBe(weapon.damage);
      expect(shot?.pierce).toBe(weapon.pierce);
    }
  });

  /** Recoil is half of what makes the lance a trade. It has to actually push. */
  it('kicks harder with a heavier gun', () => {
    const light = onePull('stream').player.vx;
    const heavy = onePull('lance').player.vx;
    expect(heavy).toBeLessThan(light);
  });
});

describe('piercing', () => {
  const WALL_HEALTH = 200;

  /**
   * Fire one round down a line of three and report what it cost each of them.
   *
   * The three are dropped onto the round's path rather than hunting the level
   * for a stretch that happens to line some up. homeY moves with them, because
   * a drifter climbs back toward its anchor on the very next step and would
   * otherwise be somewhere else by the time the round arrived.
   */
  function throughALine(weaponId: string): number[] {
    const run = new RunState(mission(), weaponId as never);
    run.player.x = 600;
    run.player.y = run.terrain.groundAt(600) - 300;
    run.player.aimX = 1;
    run.player.aimY = 0;
    run.player.fireCooldown = 0;

    const line = run.enemies.slice(0, 3);
    expect(line).toHaveLength(3);
    for (const enemy of run.enemies) enemy.alive = false;

    line.forEach((enemy, index) => {
      enemy.kind = 'drifter';
      enemy.alive = true;
      enemy.active = true;
      enemy.health = WALL_HEALTH;
      enemy.x = run.player.x + 90 + index * 40;
      enemy.y = run.player.y;
      enemy.homeY = run.player.y;
      enemy.phase = 0;
      enemy.vx = 0;
      enemy.vy = 0;
      // Never shoots back, so nothing here depends on the player surviving.
      enemy.fireCooldown = 999;
    });

    // One pull, then coast. The trigger is released so exactly one round is
    // ever in the air and every point of damage below came from it.
    step(run, DT, { ...FIRING, aimX: run.player.x + 400, aimY: run.player.y });
    for (let i = 0; i < 30; i++) {
      step(run, DT, { moveX: 0, moveY: 0, aimX: null, aimY: null, firing: false });
    }

    return line.map((e) => WALL_HEALTH - e.health);
  }

  it('passes through one enemy and stops at the next', () => {
    const damage = throughALine('lance');
    expect(damage.filter((d) => d > 0)).toHaveLength(2);
  });

  /**
   * The one that matters. A round is a snapshot test away from hitting the
   * same enemy on two consecutive steps, because it has not cleared the hit
   * box yet, and that would quietly double a lance's damage and turn the whole
   * rack into an upgrade ladder.
   */
  it('never charges the same enemy twice for one round', () => {
    const weapon = weaponById('lance');
    for (const dealt of throughALine('lance')) {
      expect(dealt === 0 || dealt === weapon.damage).toBe(true);
    }
  });

  it('stops dead at the first enemy without piercing', () => {
    const damage = throughALine('sidearm');
    expect(damage.filter((d) => d > 0)).toHaveLength(1);
  });
});
