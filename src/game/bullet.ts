/**
 * Bullets. Straight lines with a lifetime.
 *
 * They are stored in one flat array with a `friendly` flag rather than two
 * arrays, because every consumer wants to iterate all of them anyway and one
 * loop with a branch beats two loops that can fall out of step.
 *
 * Dead bullets are compacted in place at the end of the update rather than
 * spliced out during it, so nothing shifts under an in-progress iteration.
 */

import type { Bullet, RunState } from './state';
import { hitsGround } from './collision';
import { WORLD_HEIGHT, WORLD_WIDTH, CEILING } from './terrain';

/*
 * The player's own speed and damage used to live here as two constants. They
 * moved to data/weapons.ts when the rack became a choice, because a second
 * copy of a number the gun already carries is a number that will be edited in
 * one place and read from the other.
 */

/**
 * Deliberately well under the player's own rounds.
 *
 * Reaction time is the difference between a shot you dodged and a shot that
 * simply happened to you. Slowing incoming fire buys that time without making
 * the level emptier, which is the trade worth taking: fewer surprises, same
 * number of decisions.
 */
export const ENEMY_BULLET_SPEED = 258;
export const ENEMY_BULLET_DAMAGE = 11;
export const BULLET_RADIUS = 4;

/** Ceiling on live bullets, so a stuck fire input cannot grind a phone down. */
const MAX_BULLETS = 240;

export function spawnBullet(state: RunState, bullet: Bullet): void {
  if (state.bullets.length >= MAX_BULLETS) return;
  state.bullets.push(bullet);
}

export function updateBullets(state: RunState, dt: number): void {
  for (const bullet of state.bullets) {
    if (bullet.life <= 0) continue;

    bullet.x += bullet.vx * dt;
    bullet.y += bullet.vy * dt;
    bullet.life -= dt;

    const outOfWorld =
      bullet.x < -40 ||
      bullet.x > WORLD_WIDTH + 40 ||
      bullet.y < CEILING - 40 ||
      bullet.y > WORLD_HEIGHT + 40;

    if (outOfWorld) {
      bullet.life = 0;
      continue;
    }

    if (hitsGround({ x: bullet.x, y: bullet.y, r: BULLET_RADIUS }, state.terrain)) {
      bullet.life = 0;
      state.emit({ kind: 'hit', x: bullet.x, y: bullet.y });
    }
  }

  compact(state);
}

/** Drop expired bullets without reallocating the array every frame. */
function compact(state: RunState): void {
  const live = state.bullets;
  let write = 0;
  for (let read = 0; read < live.length; read++) {
    const bullet = live[read];
    if (bullet && bullet.life > 0) {
      live[write++] = bullet;
    }
  }
  live.length = write;
}
