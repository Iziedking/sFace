/**
 * The player: jetpack physics, guns, and the ground.
 *
 * The update takes a PlayerCommand rather than the Input object. That one
 * indirection is what makes a recorded run replayable: a ghost feeds the same
 * struct from a trace and produces the same flight, and neither path knows
 * which it is. Do not reach into Input from here.
 *
 * Feel notes, since this is the part that decides whether the game is any good.
 * Thrust is strong and drag is high, so the ship answers immediately and stops
 * when you let go. Gravity is present but gentle enough that hovering is a
 * skill rather than a chore. Hitting the ground hurts in proportion to how fast
 * you hit it, so brushing a hill is survivable and dropping onto one is not.
 */

import { clamp, direction, groundPenetration } from './collision';
import { spawnBullet, PLAYER_BULLET_DAMAGE, PLAYER_BULLET_SPEED, BULLET_RADIUS } from './bullet';
import type { RunState } from './state';
import { PLAYER_MAX_HEALTH } from './state';
import { CEILING, WORLD_WIDTH } from './terrain';

export const PLAYER_RADIUS = 17;

const THRUST = 1750;
const GRAVITY = 780;
/** Fraction of velocity kept per second. Low number, snappy ship. */
const DRAG_PER_SECOND = 0.02;
const MAX_SPEED = 400;
const FIRE_INTERVAL = 0.125;
const MUZZLE_OFFSET = 20;

/** Below this impact speed, touching the ground is free. */
const SAFE_LANDING_SPEED = 260;
const CRASH_DAMAGE_PER_SPEED = 0.14;
const INVULNERABLE_SECONDS = 0.6;

/** Every carried face this heavy costs you this share of your thrust. */
const HEAVY_THRUST_PENALTY = 0.22;

/** Positions kept for the follow chain. 90 steps is 1.5 seconds of trail. */
const TRAIL_LENGTH = 90;

export interface PlayerCommand {
  /** Thrust axes, each in [-1, 1]. */
  moveX: number;
  moveY: number;
  /** Aim target in world coordinates, or null to hold the last direction. */
  aimX: number | null;
  aimY: number | null;
  firing: boolean;
}

export function updatePlayer(state: RunState, dt: number, command: PlayerCommand): void {
  const player = state.player;

  // The Exchange King is heavy. Carrying him is a real cost, not a label.
  const heavyCount = state.faces.filter(
    (f) => f.state === 'following' && f.quirk === 'heavy',
  ).length;
  const thrustScale = Math.max(0.4, 1 - heavyCount * HEAVY_THRUST_PENALTY);

  player.vx += command.moveX * THRUST * thrustScale * dt;
  player.vy += command.moveY * THRUST * thrustScale * dt + GRAVITY * dt;

  const damping = Math.pow(DRAG_PER_SECOND, dt);
  player.vx *= damping;
  player.vy *= damping;

  const speed = Math.hypot(player.vx, player.vy);
  if (speed > MAX_SPEED) {
    player.vx = (player.vx / speed) * MAX_SPEED;
    player.vy = (player.vy / speed) * MAX_SPEED;
  }

  player.x += player.vx * dt;
  player.y += player.vy * dt;

  if (Math.abs(player.vx) > 12) player.facing = player.vx > 0 ? 1 : -1;

  constrain(state);
  aim(state, command);
  fire(state, dt, command);
  recordTrail(state);
}

/** Keep the ship inside the world and make the ground hurt honestly. */
function constrain(state: RunState): void {
  const player = state.player;

  player.x = clamp(player.x, PLAYER_RADIUS, WORLD_WIDTH - PLAYER_RADIUS);

  if (player.y < CEILING + PLAYER_RADIUS) {
    player.y = CEILING + PLAYER_RADIUS;
    // Bleed the upward velocity rather than zeroing it, so the ceiling feels
    // like a limit and not a wall you stick to.
    player.vy = Math.max(player.vy, 0) * 0.2;
  }

  const sunk = groundPenetration(
    { x: player.x, y: player.y, r: PLAYER_RADIUS },
    state.terrain,
  );

  if (sunk > 0) {
    player.y -= sunk;
    const impact = player.vy;
    player.vy = Math.min(player.vy, 0) * 0.25;
    player.vx *= 0.7;

    if (impact > SAFE_LANDING_SPEED) {
      damagePlayer(state, (impact - SAFE_LANDING_SPEED) * CRASH_DAMAGE_PER_SPEED);
    }
  }
}

function aim(state: RunState, command: PlayerCommand): void {
  const player = state.player;
  if (command.aimX === null || command.aimY === null) return;

  const unit = direction(player.x, player.y, command.aimX, command.aimY);
  player.aimX = unit.x;
  player.aimY = unit.y;
}

function fire(state: RunState, dt: number, command: PlayerCommand): void {
  const player = state.player;
  player.fireCooldown -= dt;

  if (!command.firing || player.fireCooldown > 0) return;

  player.fireCooldown = FIRE_INTERVAL;
  player.lastFiredAt = state.time;

  spawnBullet(state, {
    x: player.x + player.aimX * MUZZLE_OFFSET,
    y: player.y + player.aimY * MUZZLE_OFFSET,
    vx: player.aimX * PLAYER_BULLET_SPEED + player.vx * 0.3,
    vy: player.aimY * PLAYER_BULLET_SPEED + player.vy * 0.3,
    life: 1.1,
    damage: PLAYER_BULLET_DAMAGE,
    friendly: true,
  });

  // A little kick backwards. It sells the gun and it costs nothing.
  player.vx -= player.aimX * 26;
  player.vy -= player.aimY * 26;
}

/**
 * Freed faces follow a delayed copy of the player's path rather than steering
 * toward the player directly. Chasing produces a clump that clips through the
 * ground on every dive. A trail produces a line that flies where you flew.
 */
function recordTrail(state: RunState): void {
  state.trail.unshift({ x: state.player.x, y: state.player.y });
  if (state.trail.length > TRAIL_LENGTH) state.trail.length = TRAIL_LENGTH;
}

export function damagePlayer(state: RunState, amount: number): void {
  const player = state.player;
  if (state.time < player.invulnerableUntil) return;
  if (state.finished) return;

  player.health = Math.max(0, player.health - amount);
  player.invulnerableUntil = state.time + INVULNERABLE_SECONDS;
  state.emit({ kind: 'hit', x: player.x, y: player.y });

  if (player.health <= 0) {
    player.health = 0;
    state.phase = 'died';
  }
}

export function healthFraction(state: RunState): number {
  return state.player.health / PLAYER_MAX_HEALTH;
}

/** Radius used for the bullet and contact tests against the player. */
export function playerCircle(state: RunState): { x: number; y: number; r: number } {
  return { x: state.player.x, y: state.player.y, r: PLAYER_RADIUS };
}

export { BULLET_RADIUS };
