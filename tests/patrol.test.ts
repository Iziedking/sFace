/**
 * City attackers.
 *
 * Reported from a playtest as "no enemies coming". They were there; waking was
 * keyed to a difference in x, so in a map five thousand wide it woke a vertical
 * strip rather than the neighbourhood the player was standing in, and every
 * behaviour underneath assumed a ground line that a city does not have.
 *
 * The sense model replaces it, and the tests here pin the property the whole
 * city rests on: the car is fast AND loud, so speed costs surprise.
 */

import { describe, expect, it } from 'vitest';

import { practiceMission } from '../src/game/mission';
import { RunState } from '../src/game/state';
import { step } from '../src/game/update';
import { canSense, senseRange, updatePatrol } from '../src/game/patrol';
import { damageEnemy, radiusOf } from '../src/game/enemy';
import { spawnBullet } from '../src/game/bullet';
import { solidAt } from '../src/game/city';
import type { PlayerCommand } from '../src/game/player';

const STILL: PlayerCommand = { moveX: 0, moveY: 0, aimX: null, aimY: null, firing: false };

function city() {
  const state = new RunState(practiceMission('2026-07-29'), 'sidearm', 5);
  /*
   * Stand where a run actually starts.
   *
   * The constructor leaves the player wherever the chart put them, and the app
   * moves them to the city start when a run begins. Skipping that left the test
   * standing somewhere arbitrary, often with a building between it and the
   * watcher, so three tests failed for a reason that had nothing to do with
   * what they were checking.
   */
  state.player.x = state.city!.startX;
  state.player.y = state.city!.startY;
  return state;
}

/** Put one attacker in clear view, a short way off, and drop the rest. */
function loneWatcher(state: RunState, distance: number) {
  const enemy = state.enemies[0]!;
  state.enemies.length = 0;
  state.enemies.push(enemy);

  enemy.alive = true;
  enemy.active = false;
  enemy.notice = 0;
  enemy.alertUntil = -1;
  enemy.x = state.player.x + distance;
  enemy.y = state.player.y;
  return enemy;
}

describe('they come now', () => {
  it('notices a player standing in the open nearby', () => {
    const state = city();
    const enemy = loneWatcher(state, 150);

    for (let i = 0; i < 120; i++) step(state, 1 / 60, STILL);
    expect(enemy.notice).toBe(1);
    expect(state.time).toBeLessThan(enemy.alertUntil);
  });

  it('closes the distance once it has noticed', () => {
    const state = city();
    // Inside foot sense range. At 420 it legitimately cannot see you, so the
    // first version of this test was measuring a patrol wandering off.
    const enemy = loneWatcher(state, 300);
    const from = Math.hypot(enemy.x - state.player.x, enemy.y - state.player.y);

    for (let i = 0; i < 240; i++) step(state, 1 / 60, STILL);
    const to = Math.hypot(enemy.x - state.player.x, enemy.y - state.player.y);
    expect(to).toBeLessThan(from);
  });

  it('shoots once engaged', () => {
    const state = city();
    loneWatcher(state, 200);

    let hostile = 0;
    for (let i = 0; i < 300; i++) {
      step(state, 1 / 60, STILL);
      hostile += state.bullets.filter((b) => !b.friendly && b.life > 0).length > 0 ? 1 : 0;
    }
    expect(hostile).toBeGreaterThan(0);
  });
});

describe('they are not hunting you until they see you', () => {
  it('ignores somebody far across the map', () => {
    const state = city();
    const enemy = loneWatcher(state, 2000);

    for (let i = 0; i < 180; i++) step(state, 1 / 60, STILL);
    expect(enemy.notice).toBe(0);
    expect(enemy.active).toBe(false);
  });

  it('walks its patch rather than standing still', () => {
    const state = city();
    const enemy = loneWatcher(state, 2600);
    const from = { x: enemy.x, y: enemy.y };

    for (let i = 0; i < 180; i++) step(state, 1 / 60, STILL);
    expect(Math.hypot(enemy.x - from.x, enemy.y - from.y)).toBeGreaterThan(20);
  });

  it('never patrols into a building', () => {
    const state = city();
    for (let i = 0; i < 600; i++) {
      step(state, 1 / 60, STILL);
      for (const enemy of state.enemies) {
        if (enemy.alive) expect(solidAt(state.city!, enemy.x, enemy.y)).toBe(false);
      }
    }
  });
});

describe('walls hide you', () => {
  it('cannot sense through a building', () => {
    const state = city();
    const block = state.city!.blocks[0]!;

    // Either side of a wall, close enough that only the wall matters.
    state.player.x = block.x - 40;
    state.player.y = block.y + block.h / 2;
    const enemy = loneWatcher(state, block.w + 80);

    expect(canSense(state, enemy)).toBe(false);
  });
});

describe('the car is fast and loud', () => {
  it('is sensed from more than twice as far as on foot', () => {
    const state = city();
    const onFoot = senseRange(state);

    state.driving = true;
    const inCar = senseRange(state);

    // The whole trade. Same range and the car would be a strict upgrade.
    expect(inCar).toBeGreaterThan(onFoot * 2);
  });

  it('is noticed where a person on foot would not be', () => {
    const walking = city();
    const enemyA = loneWatcher(walking, 520);
    for (let i = 0; i < 120; i++) step(walking, 1 / 60, STILL);

    const driving = city();
    const enemyB = loneWatcher(driving, 520);
    driving.driving = true;
    for (let i = 0; i < 120; i++) step(driving, 1 / 60, STILL);

    /*
     * Compared, not asserted at zero.
     *
     * A patrol walks while it has not seen you, so one that starts outside foot
     * range can wander into it and pick up a trace of notice. That is correct
     * behaviour, and pinning an exact zero was testing the patrol's drift
     * rather than the difference the car makes.
     */
    expect(enemyB.notice).toBe(1);
    expect(enemyA.notice).toBeLessThan(0.5);
  });
});

describe('city attackers stay settleable', () => {
  it('behave identically on one seed for the same input', () => {
    const a = city();
    const b = city();
    const traceA: string[] = [];
    const traceB: string[] = [];

    for (let i = 0; i < 300; i++) {
      const command: PlayerCommand = {
        moveX: Math.sin(i / 37),
        moveY: Math.cos(i / 51),
        aimX: null,
        aimY: null,
        firing: i % 7 === 0,
      };
      step(a, 1 / 60, command);
      step(b, 1 / 60, command);
      traceA.push(a.enemies.map((e) => `${e.x.toFixed(2)}:${e.notice.toFixed(3)}`).join('|'));
      traceB.push(b.enemies.map((e) => `${e.x.toFixed(2)}:${e.notice.toFixed(3)}`).join('|'));
    }
    expect(traceA).toEqual(traceB);
  });
});

/**
 * Shooting people who have not noticed you.
 *
 * Reported from a playtest as only being able to kill attackers from the car.
 * Two guards were doing it: the bullet test and the renderer both skipped any
 * attacker that was not `active`, and in a city that flag only flips once a
 * patrol has SENSED you. So an unaware patrol was invisible AND immune, and
 * climbing into the car looked like the cause because driving is sensed from
 * more than twice as far away.
 */
describe('unaware patrols', () => {
  it('takes damage from a bullet while it has not noticed you', () => {
    const state = city();
    const enemy = loneWatcher(state, 150);
    enemy.active = false;
    enemy.notice = 0;
    enemy.alertUntil = -1;

    const before = enemy.health;
    damageEnemy(state, enemy, 9);

    expect(enemy.health).toBe(before - 9);
  });

  it('can be killed outright without ever having sensed you', () => {
    const state = city();
    const enemy = loneWatcher(state, 150);
    enemy.active = false;

    damageEnemy(state, enemy, 999);

    expect(enemy.alive).toBe(false);
    expect(state.attackersCleared).toBe(1);
  });

  it('wakes and comes for you once hit', () => {
    // Otherwise it keeps walking its beat while its health drains, which reads
    // as the shot not landing even though it did.
    const state = city();
    const enemy = loneWatcher(state, 150);
    enemy.active = false;
    enemy.notice = 0;
    enemy.alertUntil = -1;

    damageEnemy(state, enemy, 5);

    expect(enemy.active).toBe(true);
    expect(enemy.alertUntil).toBeGreaterThan(state.time);
  });

  it('is hit by a round fired on foot, not only from the car', () => {
    // The reported symptom, as a test. Fire a friendly round into a patrol that
    // has not noticed us and check the health moves.
    const state = city();
    const enemy = loneWatcher(state, 150);
    enemy.active = false;
    enemy.notice = 0;
    enemy.alertUntil = -1;
    state.driving = false;

    enemy.x = state.player.x + 120;
    enemy.y = state.player.y;

    const before = enemy.health;
    spawnBullet(state, {
      x: state.player.x + 20,
      y: state.player.y,
      vx: 600,
      vy: 0,
      life: 1.5,
      damage: 11,
      friendly: true,
      pierce: 0,
    });

    for (let i = 0; i < 30; i++) step(state, 1 / 60, STILL);

    expect(enemy.health).toBeLessThan(before);
  });
});

/**
 * Patrol cars.
 *
 * The second city stage needed to be a different place rather than the first
 * with a wash over it, and traffic that is hunting you is the cheapest honest
 * way to get there.
 */
describe('patrol cars', () => {
  it('only puts them on the downtown stage', () => {
    const five = new RunState(practiceMission('2026-07-29'), 'sidearm', 5);
    const six = new RunState(practiceMission('2026-07-29'), 'sidearm', 6);

    expect(five.enemies.some((e) => e.driving)).toBe(false);
    expect(six.enemies.some((e) => e.driving)).toBe(true);
  });

  it('never puts a rooted turret in a car', () => {
    const six = new RunState(practiceMission('2026-07-29'), 'sidearm', 6);
    for (const enemy of six.enemies) {
      if (enemy.kind === 'turret') expect(enemy.driving).toBe(false);
    }
  });

  it('is a bigger target than someone on foot', () => {
    // The trade for being faster and seeing further: any round that touches the
    // car counts, so you do not have to pick the driver out of a windscreen.
    const six = new RunState(practiceMission('2026-07-29'), 'sidearm', 6);
    const driver = six.enemies.find((e) => e.driving)!;
    const walker = six.enemies.find((e) => !e.driving && e.kind !== 'turret')!;

    expect(radiusOf(driver)).toBeGreaterThan(radiusOf(walker));
  });

  it('senses further than someone on foot', () => {
    const state = city();
    const enemy = loneWatcher(state, 150);

    enemy.driving = false;
    const walking = senseRange(state, enemy);
    enemy.driving = true;

    expect(senseRange(state, enemy)).toBeGreaterThan(walking);
  });

  it('stays slower than the car the player drives', () => {
    // A patrol car that outran you would make every sighting a fight you cannot
    // leave, which removes the choice the city is built on.
    const state = city();
    const enemy = loneWatcher(state, 150);
    enemy.driving = true;
    enemy.active = false;
    enemy.alertUntil = -1;
    enemy.patrolHeading = 0;

    const startX = enemy.x;
    for (let i = 0; i < 60; i++) updatePatrol(state, enemy, 1 / 60);
    const travelled = Math.abs(enemy.x - startX);

    expect(travelled).toBeLessThan(CAR_MAX_SPEED_REFERENCE);
  });
});

/** The player's own top speed, from car.ts. Patrol cars must stay under it. */
const CAR_MAX_SPEED_REFERENCE = 500;
