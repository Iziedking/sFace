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
import { solidAt } from './city';
import { solidAt as solidInRings } from './rings';

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

    /*
     * The bounds depend on which world this is, and there are three of them.
     *
     * This has now bitten twice, identically. The chart world is nine hundred
     * and sixty tall, the block city is four thousand, and the ring city is
     * nearly six thousand across. A world that falls through to another world's
     * bounds has every round culled on the frame it is fired.
     *
     * The symptom is unmistakable once you know it: attackers can shoot you and
     * your own shots do nothing, because their rounds reach you within a frame
     * while yours never travel at all. Any world added after this one needs its
     * own branch here BEFORE it ships, not after somebody reports it.
     */
    const rings = state.rings;

    if (rings) {
      if (
        bullet.x < -40 ||
        bullet.x > rings.width + 40 ||
        bullet.y < -40 ||
        bullet.y > rings.height + 40
      ) {
        bullet.life = 0;
        continue;
      }

      // Ring walls stop rounds, the same way buildings do. A wall you can shoot
      // through is not cover, and this stage is built on walls making you go
      // around them.
      if (solidInRings(rings, bullet.x, bullet.y)) {
        bullet.life = 0;
        state.emit({ kind: 'hit', x: bullet.x, y: bullet.y });
      }
      continue;
    }

    const city = state.city;

    if (city) {
      if (
        bullet.x < -40 ||
        bullet.x > city.width + 40 ||
        bullet.y < -40 ||
        bullet.y > city.height + 40
      ) {
        bullet.life = 0;
        continue;
      }

      // Buildings stop rounds, which is what makes a corner cover rather than
      // decoration. There is no ground to hit.
      if (solidAt(city, bullet.x, bullet.y)) {
        bullet.life = 0;
        state.emit({ kind: 'hit', x: bullet.x, y: bullet.y });
      }
      continue;
    }

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
