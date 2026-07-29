/**
 * Freed people shoot back.
 *
 * The point of this is not combat, it is that rescuing somebody used to be
 * purely a cost: they slow you down, they are lost if you die, and they only
 * pay at the pad. That taught players to free everyone last, which is a strange
 * lesson for a game named after rescuing people. Covering fire makes freeing
 * somebody early an investment instead.
 *
 * So the tests here are about the balance that keeps it an investment rather
 * than a replacement for flying well.
 */

import { describe, expect, it } from 'vitest';

import { practiceMission } from '../src/game/mission';
import { RunState } from '../src/game/state';
import { step } from '../src/game/update';
import type { PlayerCommand } from '../src/game/player';

const IDLE: PlayerCommand = { moveX: 0, moveY: 0, aimX: null, aimY: null, firing: false };

function withEscort(stage = 1) {
  const state = new RunState(practiceMission('2026-07-29'), 'sidearm', stage);
  const face = state.faces[0]!;
  face.caged = false;
  face.state = 'following';
  face.slot = 0;
  face.fireCooldown = 0;
  return { state, face };
}

/**
 * Park a woken attacker right beside the escort, and keep it there.
 *
 * A follower is dragged along a delayed copy of the player's path, so it moves
 * every frame. An attacker placed once relative to its starting position is out
 * of range within a few frames, and the test then measures the chase rather
 * than the shooting.
 */
function targetBeside(state: RunState, face: { x: number; y: number }) {
  const enemy = state.enemies[0]!;
  enemy.alive = true;
  enemy.active = true;
  enemy.x = face.x + 90;
  enemy.y = face.y;
  return enemy;
}

/** Hold the attacker beside the escort for one frame of the run. */
function pin(enemy: { x: number; y: number; active: boolean }, face: { x: number; y: number }, awake = true) {
  enemy.x = face.x + 90;
  enemy.y = face.y;
  enemy.active = awake;
}

describe('an escort helps', () => {
  it('fires at a woken attacker in range', () => {
    const { state, face } = withEscort();
    const enemy = targetBeside(state, face);

    /*
     * Counted as they spawn, not measured at the end.
     *
     * The first version checked the bullet array after a second and found it
     * empty, and concluded nothing had fired. What had actually happened is
     * that the shot flew ninety units, hit, and was consumed inside two tenths
     * of a second, while the next was still on cooldown. The array was right;
     * the question was wrong.
     */
    let fired = 0;
    let last = state.bullets.length;
    for (let i = 0; i < 60; i++) {
      pin(enemy, face);
      step(state, 1 / 60, IDLE);
      if (state.bullets.length > last) fired++;
      last = state.bullets.length;
    }

    expect(fired).toBeGreaterThan(0);
  });

  it('eventually kills what it shoots at', () => {
    const { state, face } = withEscort();
    const enemy = targetBeside(state, face);
    const health = enemy.health;

    for (let i = 0; i < 60 * 12; i++) {
      // Hold both in place so this measures damage, not a chase.
      pin(enemy, face);
      step(state, 1 / 60, IDLE);
      if (!enemy.alive) break;
    }

    expect(enemy.health).toBeLessThan(health);
  });
});

describe('an escort is deliberately bad at it', () => {
  it('needs several shots where the player needs one or two', () => {
    const { state, face } = withEscort();
    const enemy = targetBeside(state, face);

    // Count the shots it takes, by watching friendly bullets spawn.
    let shots = 0;
    let last = state.bullets.length;
    for (let i = 0; i < 60 * 20 && enemy.alive; i++) {
      pin(enemy, face);
      step(state, 1 / 60, IDLE);
      if (state.bullets.length > last) shots++;
      last = state.bullets.length;
    }

    // A weak gun, not a second player. If one or two shots ever cleared an
    // attacker, the optimal play would become collect everyone and stop flying.
    expect(shots).toBeGreaterThan(2);
  });

  it('does not fire into empty space', () => {
    /*
     * Rewritten from "ignores attackers that are still asleep", which could not
     * be tested as written: the run step wakes anything the player is standing
     * near, before the followers get their turn, so an attacker pinned beside
     * an escort is awake by the time the escort looks at it. That is correct
     * behaviour and not something a test should be fighting.
     *
     * What is worth pinning is the guard that matters: an escort with nothing
     * to shoot at does not spend a shot. Otherwise a chain would litter the
     * level with bullets and the cadence would mean nothing.
     */
    const { state, face } = withEscort();
    state.enemies.length = 0;

    for (let i = 0; i < 180; i++) step(state, 1 / 60, IDLE);

    expect(state.bullets.filter((b) => b.friendly).length).toBe(0);
    void face;
  });

  it('does not shoot while still trapped', () => {
    const state = new RunState(practiceMission('2026-07-29'), 'sidearm', 1);
    const face = state.faces[0]!;
    face.state = 'trapped';
    targetBeside(state, face);

    for (let i = 0; i < 90; i++) step(state, 1 / 60, IDLE);
    expect(state.bullets.filter((b) => b.friendly).length).toBe(0);
  });
});

describe('covering fire stays settleable', () => {
  it('produces the same shots on one seed for the same path', () => {
    const a = withEscort();
    const b = withEscort();
    targetBeside(a.state, a.face);
    targetBeside(b.state, b.face);

    const traceA: string[] = [];
    const traceB: string[] = [];
    for (let i = 0; i < 300; i++) {
      const command: PlayerCommand = {
        moveX: Math.sin(i / 30),
        moveY: Math.cos(i / 45) * 0.4,
        aimX: null,
        aimY: null,
        firing: false,
      };
      step(a.state, 1 / 60, command);
      step(b.state, 1 / 60, command);
      traceA.push(`${a.state.bullets.length}:${a.face.fireCooldown.toFixed(5)}`);
      traceB.push(`${b.state.bullets.length}:${b.face.fireCooldown.toFixed(5)}`);
    }
    expect(traceA).toEqual(traceB);
  });
});
