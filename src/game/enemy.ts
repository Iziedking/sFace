/**
 * The attackers. Three kinds, and each one asks a different question.
 *
 *   drifter  Hovers and shoots aimed single rounds. Punishes standing still.
 *   diver    Ignores its gun and flies at you. Punishes hovering in the open.
 *   turret   Bolted to the chart, throws a spread upward. Punishes flying low.
 *
 * Between them you cannot solve the level with one habit, which is the whole
 * design goal. A fourth type would be less valuable than making these three
 * read clearly at a glance on a phone screen.
 *
 * Placement is decided once at level construction from the seed. This file only
 * wakes them and runs their behaviour, and it draws from runRng, never from the
 * level stream, so two players on the same seed keep the same level.
 */

import { direction, withinRange } from './collision';
import { spawnBullet, ENEMY_BULLET_DAMAGE, ENEMY_BULLET_SPEED } from './bullet';
import type { Enemy, RunState } from './state';
import { ATTACKER_SCORE } from './state';
import { CEILING, WORLD_HEIGHT } from './terrain';

export const ENEMY_RADIUS = 16;
export const TURRET_RADIUS = 19;
export const DIVER_CONTACT_DAMAGE = 18;

/** How far ahead of the player an enemy wakes up. Roughly one screen. */
const ACTIVATION_RANGE = 780;
/** Past this far behind, stop spending cycles on it. */
const ABANDON_RANGE = 900;

const DRIFTER_SPEED = 46;
const DRIFTER_BOB = 34;
const DIVER_ACCEL = 620;
const DIVER_MAX_SPEED = 300;
const DIVER_TRIGGER_RANGE = 460;

export function radiusOf(enemy: Enemy): number {
  return enemy.kind === 'turret' ? TURRET_RADIUS : ENEMY_RADIUS;
}

export function updateEnemies(state: RunState, dt: number): void {
  const player = state.player;
  // Extreme fear means faster, angrier attackers. The market sets the tempo.
  const aggression = 0.7 + state.mission.difficulty * 0.16;

  for (const enemy of state.enemies) {
    if (!enemy.alive) continue;

    if (!enemy.active) {
      if (enemy.x - player.x < ACTIVATION_RANGE) enemy.active = true;
      else continue;
    }

    if (player.x - enemy.x > ABANDON_RANGE) continue;

    enemy.phase += dt;

    switch (enemy.kind) {
      case 'drifter':
        updateDrifter(state, enemy, dt, aggression);
        break;
      case 'diver':
        updateDiver(state, enemy, dt, aggression);
        break;
      case 'turret':
        updateTurret(state, enemy, dt, aggression);
        break;
    }
  }
}

function updateDrifter(state: RunState, enemy: Enemy, dt: number, aggression: number): void {
  const player = state.player;

  // Close the horizontal gap slowly and bob on a sine, so it reads as hovering
  // rather than charging. The bob is off the placement height, not the current
  // one, or the drift and the bob compound and it wanders off screen.
  const toward = Math.sign(player.x - enemy.x);
  enemy.x += toward * DRIFTER_SPEED * dt;
  enemy.y = enemy.homeY + Math.sin(enemy.phase * 1.6) * DRIFTER_BOB;
  enemy.y = clampToWorld(enemy.y);

  enemy.fireCooldown -= dt * aggression;
  if (enemy.fireCooldown > 0) return;

  enemy.fireCooldown = state.runRng.range(1.4, 2.6);

  const unit = direction(enemy.x, enemy.y, player.x, player.y);
  spawnBullet(state, {
    x: enemy.x + unit.x * 18,
    y: enemy.y + unit.y * 18,
    vx: unit.x * ENEMY_BULLET_SPEED,
    vy: unit.y * ENEMY_BULLET_SPEED,
    life: 3,
    damage: ENEMY_BULLET_DAMAGE,
    friendly: false,
  });
}

function updateDiver(state: RunState, enemy: Enemy, dt: number, aggression: number): void {
  const player = state.player;

  if (!withinRange(enemy.x, enemy.y, player.x, player.y, DIVER_TRIGGER_RANGE)) {
    // Idle drift back toward its lane so it does not sink into the ground
    // while it waits.
    enemy.vy += (enemy.homeY - enemy.y) * 1.4 * dt;
    enemy.vx *= 0.94;
    enemy.vy *= 0.94;
  } else {
    const unit = direction(enemy.x, enemy.y, player.x, player.y);
    enemy.vx += unit.x * DIVER_ACCEL * aggression * dt;
    enemy.vy += unit.y * DIVER_ACCEL * aggression * dt;

    const speed = Math.hypot(enemy.vx, enemy.vy);
    const cap = DIVER_MAX_SPEED * aggression;
    if (speed > cap) {
      enemy.vx = (enemy.vx / speed) * cap;
      enemy.vy = (enemy.vy / speed) * cap;
    }
  }

  enemy.x += enemy.vx * dt;
  enemy.y += enemy.vy * dt;

  // A diver that buries itself in a hill is a diver you cannot shoot back at.
  const ground = state.terrain.groundAt(enemy.x) - ENEMY_RADIUS;
  if (enemy.y > ground) {
    enemy.y = ground;
    enemy.vy = Math.min(enemy.vy, 0);
  }
  enemy.y = clampToWorld(enemy.y);
}

function updateTurret(state: RunState, enemy: Enemy, dt: number, aggression: number): void {
  const player = state.player;

  // Turrets ride the chart. If the ground moved, the turret moved with it.
  enemy.y = state.terrain.groundAt(enemy.x) - 26;

  enemy.fireCooldown -= dt * aggression;
  if (enemy.fireCooldown > 0) return;
  if (!withinRange(enemy.x, enemy.y, player.x, player.y, 700)) return;

  enemy.fireCooldown = state.runRng.range(2.0, 3.2);

  const unit = direction(enemy.x, enemy.y, player.x, player.y);
  const base = Math.atan2(unit.y, unit.x);

  // A three-shot fan. Wide enough to punish a straight line, narrow enough to
  // be flyable if you are moving.
  for (const offset of [-0.22, 0, 0.22]) {
    const angle = base + offset;
    spawnBullet(state, {
      x: enemy.x + Math.cos(angle) * 22,
      y: enemy.y + Math.sin(angle) * 22,
      vx: Math.cos(angle) * ENEMY_BULLET_SPEED * 0.9,
      vy: Math.sin(angle) * ENEMY_BULLET_SPEED * 0.9,
      life: 3,
      damage: ENEMY_BULLET_DAMAGE,
      friendly: false,
    });
  }
}

export function damageEnemy(state: RunState, enemy: Enemy, amount: number): void {
  if (!enemy.alive) return;

  enemy.health -= amount;
  state.emit({ kind: 'hit', x: enemy.x, y: enemy.y });

  if (enemy.health <= 0) {
    enemy.alive = false;
    state.attackersCleared++;
    state.emit({ kind: 'kill', x: enemy.x, y: enemy.y });
  }
}

/** True when any live, woken attacker is within range. Madam Cold Storage asks. */
export function threatNear(state: RunState, x: number, y: number, range: number): boolean {
  return state.enemies.some(
    (enemy) => enemy.alive && enemy.active && withinRange(enemy.x, enemy.y, x, y, range),
  );
}

function clampToWorld(y: number): number {
  return Math.min(WORLD_HEIGHT - 40, Math.max(CEILING + 20, y));
}

export { ATTACKER_SCORE };
