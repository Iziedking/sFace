/**
 * Whole runs, played start to finish by an autopilot.
 *
 * A ninety second loop cannot be checked by looking at it, and the endings are
 * where the scoring rules live: what a death costs you, what the clock costs
 * you, and what reaching the pad is worth. Those rules decide who wins a
 * challenge, so they are tested rather than eyeballed.
 *
 * The autopilot is deliberately dumb. It holds an altitude and flies right. It
 * is not meant to play well, only to reach the end of the level so the ending
 * can be asserted.
 */

import { describe, expect, it } from 'vitest';

import { practiceMission } from '../src/game/mission';
import { RunState, RUN_SECONDS, PLAYER_MAX_HEALTH } from '../src/game/state';
import { step } from '../src/game/update';
import { WORLD_WIDTH, CEILING } from '../src/game/terrain';
import { PLAYER_RADIUS } from '../src/game/player';
import type { PlayerCommand } from '../src/game/player';

const DT = 1 / 60;
const IDLE: PlayerCommand = { moveX: 0, moveY: 0, aimX: null, aimY: null, firing: false };

function mission() {
  return practiceMission('2026-07-28');
}

/** Fly right, holding a fixed height above whatever the chart is doing. */
function autopilot(run: RunState, clearance = 200): PlayerCommand {
  const target = run.terrain.groundAt(run.player.x) - clearance;
  const drift = run.player.y - target;
  return {
    moveX: 1,
    moveY: Math.max(-1, Math.min(1, drift / 90)) * -1,
    aimX: run.player.x + 400,
    aimY: run.player.y,
    firing: true,
  };
}

/** Run until it ends or the step budget runs out. */
function play(
  run: RunState,
  command: (run: RunState) => PlayerCommand,
  maxSteps = 60 * 200,
): number {
  let steps = 0;
  while (!run.finished && steps < maxSteps) {
    step(run, DT, command(run));
    steps++;
  }
  return steps;
}

describe('a full run', () => {
  it('reaches extraction and pays a time bonus for the clock left', () => {
    const run = new RunState(mission());
    // Invulnerable, because this test is about the ending, not about combat.
    run.player.invulnerableUntil = Number.POSITIVE_INFINITY;

    play(run, (r) => autopilot(r));

    expect(run.phase).toBe('extracted');
    // The pad moves with the stage, so the run is the authority on where it is.
    expect(run.player.x).toBeGreaterThanOrEqual(run.extractionX);
    expect(run.timeLeft).toBeGreaterThan(0);
    expect(run.score).toBeGreaterThan(0);
  });

  it('times out at ninety seconds when the player never leaves the start', () => {
    const run = new RunState(mission());
    run.player.invulnerableUntil = Number.POSITIVE_INFINITY;

    play(run, () => IDLE);

    expect(run.phase).toBe('timeout');
    expect(run.time).toBeGreaterThanOrEqual(RUN_SECONDS);
  });

  it('ends the moment health reaches zero, however it got there', () => {
    const run = new RunState(mission());
    play(run, (r) => autopilot(r), 60);
    expect(run.phase).toBe('flying');

    run.player.health = 0;
    step(run, DT, IDLE);

    expect(run.phase).toBe('died');
  });
});

/**
 * The gun has to be able to point anywhere.
 *
 * This was genuinely broken: a player flying on the keyboard never gives an
 * aim, so the gun held its initial heading and fired due right for an entire
 * run, and anything above or behind them was unkillable. These lock in the
 * fallback that fixed it.
 */
describe('aiming', () => {
  const heading = (run: RunState) =>
    Math.round((Math.atan2(run.player.aimY, run.player.aimX) * 180) / Math.PI);

  it('follows the direction of flight when no aim is given', () => {
    const seen = new Set<number>();

    for (const [moveX, moveY] of [
      [1, 0],
      [0, -1],
      [-1, 0],
      [0, 1],
    ] as const) {
      const run = new RunState(mission());
      run.player.invulnerableUntil = Number.POSITIVE_INFINITY;
      for (let i = 0; i < 40; i++) {
        step(run, DT, { ...IDLE, moveX, moveY });
      }
      seen.add(heading(run));
    }

    // Four directions of travel must produce four distinct gun headings. One
    // shared value would mean the gun is stuck, which is the original bug.
    expect(seen.size).toBe(4);
  });

  it('lets an explicit aim override the direction of flight', () => {
    const run = new RunState(mission());
    run.player.invulnerableUntil = Number.POSITIVE_INFINITY;

    // Flying hard right while aiming behind and above.
    for (let i = 0; i < 30; i++) {
      step(run, DT, {
        moveX: 1,
        moveY: 0,
        aimX: run.player.x - 400,
        aimY: run.player.y - 400,
        firing: false,
      });
    }

    expect(run.player.aimX).toBeLessThan(0);
    expect(run.player.aimY).toBeLessThan(0);
  });

  /**
   * Hovering means falling and catching yourself over and over. If the gun
   * followed velocity it would swing at the floor every time gravity got a
   * moment, so a stationary player would watch their aim flap. It follows
   * thrust instead, and a hand off the stick holds the last heading.
   */
  it('holds the last heading when the stick is released', () => {
    const run = new RunState(mission());
    run.player.invulnerableUntil = Number.POSITIVE_INFINITY;

    for (let i = 0; i < 40; i++) step(run, DT, { ...IDLE, moveY: -1 });
    const flying = heading(run);
    expect(flying).toBe(-90);

    // Let gravity work on it with no input at all.
    for (let i = 0; i < 40; i++) step(run, DT, IDLE);

    expect(heading(run)).toBe(flying);
  });

  it('can fire in every direction', () => {
    const run = new RunState(mission());
    run.player.invulnerableUntil = Number.POSITIVE_INFINITY;

    const angles: number[] = [];
    for (const [dx, dy] of [
      [1, 0],
      [0, -1],
      [-1, 0],
      [0, 1],
    ] as const) {
      run.bullets.length = 0;
      run.player.fireCooldown = 0;
      step(run, DT, {
        moveX: 0,
        moveY: 0,
        aimX: run.player.x + dx * 400,
        aimY: run.player.y + dy * 400,
        firing: true,
      });

      const shot = run.bullets[0];
      expect(shot).toBeDefined();
      angles.push(Math.round((Math.atan2(shot!.vy, shot!.vx) * 180) / Math.PI));
    }

    expect(new Set(angles).size).toBe(4);
  });
});

describe('scoring rules', () => {
  it('always produces a whole, non-negative number', () => {
    const run = new RunState(mission());
    run.player.invulnerableUntil = Number.POSITIVE_INFINITY;
    play(run, (r) => autopilot(r));

    expect(Number.isInteger(run.score)).toBe(true);
    expect(run.score).toBeGreaterThanOrEqual(0);
  });

  it('credits a rescue the moment a face is freed, before it is safe', () => {
    const run = new RunState(mission());
    const face = run.faces[0]!;

    expect(run.rescueScore).toBe(0);

    // Fly the player onto the face.
    run.player.x = face.x;
    run.player.y = face.y;
    step(run, DT, IDLE);

    expect(run.facesFreed).toBe(1);
    expect(run.rescueScore).toBeGreaterThan(0);
    expect(run.extractionScore).toBe(0);
  });

  it('loses everyone still aboard when the ship goes down', () => {
    const run = new RunState(mission());
    const face = run.faces[0]!;

    run.player.x = face.x;
    run.player.y = face.y;
    step(run, DT, IDLE);
    expect(run.carrying).toBe(1);

    const bankedRescue = run.rescueScore;

    // Empty the hull and let the step resolve the ending, rather than setting
    // the phase by hand. Setting it by hand would skip the very code under test.
    run.player.invulnerableUntil = 0;
    run.player.health = 0;
    step(run, DT, IDLE);

    expect(run.phase).toBe('died');
    expect(run.faces[0]!.state).toBe('lost');
    expect(run.facesExtracted).toBe(0);
    // The rescue credit already earned is kept. The extraction half is not.
    expect(run.rescueScore).toBe(bankedRescue);
    expect(run.extractionScore).toBe(0);
  });

  it('pays no time bonus on a run that timed out', () => {
    const timedOut = new RunState(mission());
    timedOut.player.invulnerableUntil = Number.POSITIVE_INFINITY;
    play(timedOut, () => IDLE);

    expect(timedOut.phase).toBe('timeout');
    // Nothing was freed and nothing was cleared, so the whole score would have
    // to be a time bonus, and there is not supposed to be one.
    expect(timedOut.score).toBe(0);
  });

  it('scales the whole score by the bounty the market set', () => {
    const base = new RunState({ ...mission(), bountyMultiplier: 1 });
    const boosted = new RunState({ ...mission(), bountyMultiplier: 2 });

    for (const run of [base, boosted]) {
      run.player.invulnerableUntil = Number.POSITIVE_INFINITY;
      run.attackersCleared = 10;
      run.rescueScore = 100;
    }

    expect(boosted.score).toBe(base.score * 2);
  });
});

describe('the player stays inside the world', () => {
  it('cannot fly through the ceiling, the floor, or either end', () => {
    const run = new RunState(mission());
    run.player.invulnerableUntil = Number.POSITIVE_INFINITY;

    const directions: PlayerCommand[] = [
      { ...IDLE, moveX: -1 },
      { ...IDLE, moveX: 1 },
      { ...IDLE, moveY: -1 },
      { ...IDLE, moveY: 1 },
    ];

    for (const command of directions) {
      const probe = new RunState(mission());
      probe.player.invulnerableUntil = Number.POSITIVE_INFINITY;

      for (let i = 0; i < 60 * 20 && !probe.finished; i++) {
        step(probe, DT, command);

        expect(probe.player.x).toBeGreaterThanOrEqual(PLAYER_RADIUS - 0.001);
        expect(probe.player.x).toBeLessThanOrEqual(WORLD_WIDTH - PLAYER_RADIUS + 0.001);
        expect(probe.player.y).toBeGreaterThanOrEqual(CEILING);
        expect(probe.player.y).toBeLessThanOrEqual(
          probe.terrain.groundAt(probe.player.x) + 0.001,
        );
      }
    }
  });

  it('hurts you for hitting the ground hard and not for touching it gently', () => {
    const gentle = new RunState(mission());
    gentle.player.y = gentle.terrain.groundAt(gentle.player.x) - 30;
    gentle.player.vy = 60;
    for (let i = 0; i < 30; i++) step(gentle, DT, IDLE);
    expect(gentle.player.health).toBe(PLAYER_MAX_HEALTH);

    // Free fall alone cannot hurt you: drag caps the fall well under the safe
    // landing speed. Driving the jets into the ground is what costs you, which
    // is the intended shape, so that is what this asserts.
    const hard = new RunState(mission());
    hard.player.y = hard.terrain.groundAt(hard.player.x) - 300;
    for (let i = 0; i < 60 && hard.player.health === PLAYER_MAX_HEALTH; i++) {
      step(hard, DT, { ...IDLE, moveY: 1 });
    }
    expect(hard.player.health).toBeLessThan(PLAYER_MAX_HEALTH);
  });
});

describe('face quirks', () => {
  it('will not free the paranoid one while an attacker is nearby', () => {
    const run = new RunState(mission());
    const face = run.faces.find((f) => f.quirk === 'paranoid')!;

    // Park a live attacker right next to her.
    const enemy = run.enemies[0]!;
    enemy.x = face.x + 40;
    enemy.y = face.y;
    enemy.alive = true;
    enemy.active = true;

    run.player.x = face.x;
    run.player.y = face.y;
    step(run, DT, IDLE);

    expect(face.state).toBe('trapped');

    // Clear the whole route and she comes along. It has to be every attacker,
    // not just the one parked next to her: flying in wakes anything else in
    // range, and she is watching for all of them.
    for (const other of run.enemies) other.alive = false;
    run.player.x = face.x;
    run.player.y = face.y;
    step(run, DT, IDLE);

    expect(face.state).toBe('following');
  });

  it('stops the skittish one from following while you are shooting', () => {
    const run = new RunState(mission());
    const face = run.faces.find((f) => f.quirk === 'skittish')!;

    run.player.x = face.x;
    run.player.y = face.y;
    step(run, DT, IDLE);
    expect(face.state).toBe('following');

    // Fire, then fly away. It should stay put rather than follow.
    const firing: PlayerCommand = {
      moveX: 1, moveY: 0, aimX: run.player.x + 100, aimY: run.player.y, firing: true,
    };
    step(run, DT, firing);

    const held = { x: face.x, y: face.y };
    for (let i = 0; i < 30; i++) step(run, DT, { ...firing, firing: false });

    expect(face.x).toBeCloseTo(held.x, 3);
    expect(face.y).toBeCloseTo(held.y, 3);
  });

  it('lets the mercenary out partway, for less than a full extraction', () => {
    const run = new RunState(mission());
    const face = run.faces.find((f) => f.quirk === 'mercenary')!;

    run.player.x = face.x;
    run.player.y = face.y;
    step(run, DT, IDLE);
    expect(face.state).toBe('following');

    // Drag him past the point where he decides he can manage.
    face.x = face.selfExtractX + 1;
    step(run, DT, IDLE);

    expect(face.state).toBe('extracted');
    expect(run.facesExtracted).toBe(1);
    // He kept a cut, so this is below the full extraction half of his bounty.
    expect(run.extractionScore).toBeLessThan(face.bounty * 0.75);
    expect(run.extractionScore).toBeGreaterThan(0);
  });

  it('slows the ship down while the heavy one is aboard', () => {
    const free = new RunState(mission());
    const laden = new RunState(mission());

    const face = laden.faces.find((f) => f.quirk === 'heavy')!;
    laden.player.x = face.x;
    laden.player.y = face.y;
    step(laden, DT, IDLE);
    expect(face.state).toBe('following');

    // Same command, same number of steps, from a standing start.
    free.player.vx = 0;
    laden.player.vx = 0;
    const thrust: PlayerCommand = { ...IDLE, moveX: 1 };
    for (let i = 0; i < 10; i++) {
      step(free, DT, thrust);
      step(laden, DT, thrust);
    }

    expect(laden.player.vx).toBeLessThan(free.player.vx);
  });
});
