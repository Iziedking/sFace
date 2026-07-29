/**
 * Being seen, and the one property that lets it exist at all.
 *
 * A stealth stage changes the score, so it has to be reproducible: two players
 * on one seed who fly the same path must be caught at the same instant. If it
 * were not, a NIM challenge settled on stage four would be a coin toss wearing
 * a scoreboard, and nothing on screen would say so.
 */

import { describe, expect, it } from 'vitest';

import { practiceMission } from '../src/game/mission';
import { RunState } from '../src/game/state';
import { step } from '../src/game/update';
import { ALERT_FIRE_SCALE, SIGHT_RANGE, alerted, blocked, gaze, sees, watches } from '../src/game/sight';
import type { PlayerCommand } from '../src/game/player';
import { stageAt, STAGES } from '../src/data/campaign';
import { ACTIVATION_RANGE } from '../src/game/enemy';

const IDLE: PlayerCommand = { moveX: 0, moveY: 0, aimX: null, aimY: null, firing: false };

function run(stage: number): RunState {
  return new RunState(practiceMission('2026-07-29'), 'sidearm', stage);
}

/** Put a woken watcher exactly where it must see the player. */
function watcherOn(state: RunState) {
  const enemy = state.enemies.find(watches)!;
  enemy.active = true;
  enemy.kind = 'turret';
  enemy.phase = 0; // gaze looks straight up
  // Directly above it, well inside range, with no ground between.
  state.player.x = enemy.x;
  state.player.y = enemy.y - 200;
  return enemy;
}

/**
 * Step while holding the player still.
 *
 * Gravity is the whole reason this exists: left alone the ship falls out of the
 * cone within a second and lands, so a plain loop would be measuring flight
 * rather than sight. Pinning the position each frame isolates the thing under
 * test, which is when a watcher notices a body at a given place.
 */
function hover(state: RunState, frames: number, enemy: { x: number; y: number }): void {
  for (let i = 0; i < frames; i++) {
    state.player.x = enemy.x;
    state.player.y = enemy.y - 200;
    state.player.vx = 0;
    state.player.vy = 0;
    step(state, 1 / 60, IDLE);
  }
}

describe('the campaign keeps its first hour simple', () => {
  it('does not watch on stages one to three, and does from four', () => {
    for (let n = 1; n <= STAGES.length; n++) {
      expect(stageAt(n).sight).toBe(n >= 4);
    }
  });

  it('never moves the alert on a stage without sight', () => {
    const state = run(1);
    const enemy = watcherOn(state);
    hover(state, 200, enemy);
    expect(state.alert).toBe(0);
    expect(state.alertsRaised).toBe(0);
  });
});

describe('what a watcher can and cannot see', () => {
  it('sees a player inside the arc with a clear line', () => {
    const state = run(4);
    const enemy = watcherOn(state);
    expect(sees(enemy, state.terrain, 0, state.player.x, state.player.y)).toBe(true);
  });

  it('does not see past its range', () => {
    const state = run(4);
    const enemy = watcherOn(state);
    expect(sees(enemy, state.terrain, 0, enemy.x, enemy.y - SIGHT_RANGE - 50)).toBe(false);
  });

  it('does not see behind itself', () => {
    const state = run(4);
    const enemy = watcherOn(state);
    // Below a turret that is looking up.
    expect(sees(enemy, state.terrain, 0, enemy.x, enemy.y + 120)).toBe(false);
  });

  it('is blocked by ground between it and the target', () => {
    const state = run(4);
    const enemy = state.enemies.find(watches)!;
    // Straight down, which is through the ground it is standing on.
    const deep = state.terrain.groundAt(enemy.x) + 400;
    expect(blocked(state.terrain, enemy, enemy.x, deep)).toBe(true);
  });

  it('is not blocked by the ground it is standing on', () => {
    const state = run(4);
    const enemy = watcherOn(state);
    expect(blocked(state.terrain, enemy, state.player.x, state.player.y)).toBe(false);
  });

  it('does not see while asleep', () => {
    const state = run(4);
    const enemy = watcherOn(state);
    enemy.active = false;
    for (let i = 0; i < 60; i++) step(state, 1 / 60, IDLE);
    // sees() is geometry only, so the sleep check lives in the run step.
    expect(state.watched).toBe(false);
  });
});

describe('the alert fills, drains and latches', () => {
  it('fills while watched and raises at the top', () => {
    const state = run(4);
    const enemy = watcherOn(state);
    hover(state, 120, enemy);

    expect(state.alert).toBe(1);
    expect(state.alertsRaised).toBe(1);
    expect(alerted(state)).toBe(true);
  });

  it('makes the level shoot faster while it is up', () => {
    // A reload TIME multiplier below one is a shorter wait, not a longer one.
    expect(ALERT_FIRE_SCALE).toBeLessThan(1);
  });

  it('drains once the line is broken', () => {
    const state = run(4);
    const enemy = watcherOn(state);
    hover(state, 30, enemy);
    const peak = state.alert;
    expect(peak).toBeGreaterThan(0);
    // Not yet caught, or the latch would hold it up and hide the drain.
    expect(alerted(state)).toBe(false);

    /*
     * Break it properly.
     *
     * Two earlier attempts were wrong and both were instructive. Sleeping the
     * one watcher woke its neighbours, who picked the player straight back up.
     * Sleeping all of them did not hold either, because the run step re-wakes
     * anything the player is standing next to, which is correct behaviour and
     * not something a test should be fighting.
     *
     * So the watchers are removed. This test is about the meter falling when
     * nothing can see you, and the cleanest way to have nothing see you is to
     * have nothing there.
     */
    state.enemies.length = 0;
    hover(state, 120, enemy);
    expect(state.watched).toBe(false);
    expect(state.alert).toBeLessThan(peak);
  });

  it('wakes the stretch ahead rather than spawning anything', () => {
    const state = run(4);
    const enemy = watcherOn(state);
    const before = state.enemies.length;

    hover(state, 120, enemy);

    // Nothing new: a level whose size depends on how well you played would be
    // a different level for each player on the same seed.
    expect(state.enemies.length).toBe(before);
    expect(state.enemies.some((e) => e.active)).toBe(true);
  });
});

describe('a sweep is a function of the clock, not of chance', () => {
  it('gives the same heading for the same enemy at the same time', () => {
    const a = run(4);
    const b = run(4);
    const ea = a.enemies.find((e) => e.kind === 'drifter');
    const eb = b.enemies.find((e) => e.kind === 'drifter');
    if (!ea || !eb) return;

    for (const t of [0, 1.7, 5.5, 40]) {
      expect(gaze(ea, t)).toBe(gaze(eb, t));
    }
  });

  it('does not sweep every watcher in unison', () => {
    const state = run(7);
    const drifters = state.enemies.filter((e) => e.kind === 'drifter');
    if (drifters.length < 2) return;

    const headings = new Set(drifters.map((e) => gaze(e, 3).toFixed(4)));
    expect(headings.size).toBeGreaterThan(1);
  });
});

describe('two players on one seed are caught at the same instant', () => {
  it('produces an identical alert trace for an identical path', () => {
    const a = run(4);
    const b = run(4);

    const traceA: string[] = [];
    const traceB: string[] = [];

    for (let i = 0; i < 400; i++) {
      const command: PlayerCommand = {
        moveX: Math.sin(i / 40),
        moveY: Math.cos(i / 55) * 0.5,
        aimX: null,
        aimY: null,
        firing: i % 7 === 0,
      };
      step(a, 1 / 60, command);
      step(b, 1 / 60, command);
      traceA.push(`${a.alert.toFixed(6)}:${a.alertsRaised}`);
      traceB.push(`${b.alert.toFixed(6)}:${b.alertsRaised}`);
    }

    expect(traceA).toEqual(traceB);
  });
});

/**
 * The invariant that makes stealth fair rather than a dice roll.
 *
 * A watcher draws its cone only once it is awake. So if anything could ever see
 * further than it wakes, the first a player would know of it is the alert going
 * off, spotted by something that was never on screen. The margin between the
 * two constants IS the warning the player gets, and it is the kind of thing
 * that quietly disappears the next time somebody tunes one of them.
 */
describe('you always see the cone before the cone sees you', () => {
  it('wakes further out than it can see', () => {
    expect(SIGHT_RANGE).toBeLessThan(ACTIVATION_RANGE);
  });

  it('leaves a real margin, not a rounding error', () => {
    // Roughly a quarter of a screen of warning at the zoom this game runs at.
    expect(ACTIVATION_RANGE - SIGHT_RANGE).toBeGreaterThan(200);
  });
});
