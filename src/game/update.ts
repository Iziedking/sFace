/**
 * One fixed step of the run. This is the only place the order of operations
 * lives, and the order matters more than any single system in it.
 *
 * Movement first, then collisions against the positions everything actually
 * ended the step at, then end conditions last so a hit that kills you and an
 * extraction on the same step cannot both resolve. Resolving both is how you
 * get a run that reports a death and a payout together.
 */

import { updateBullets, BULLET_RADIUS } from './bullet';
import { cacheFace, cacheReach } from './cache';
import { REFILL_HEAL, REFILL_REACH } from './refill';
import { circlesOverlap, withinRange } from './collision';
import { CACHE_LINES, type CacheTier } from '../data/story';
import { PLAYER_RADIUS } from './player';
import { damageEnemy, radiusOf, updateEnemies, DIVER_CONTACT_DAMAGE } from './enemy';
import { atExtraction, extractFollowers, loseFollowers } from './face';
import { updateFaces } from './face';
import { damagePlayer, playerCircle, updatePlayer, type PlayerCommand } from './player';
import { PLAYER_MAX_HEALTH, type RunState } from './state';

export function step(state: RunState, dt: number, command: PlayerCommand): void {
  if (state.finished) return;

  state.time += dt;

  updatePlayer(state, dt, command);
  updateEnemies(state, dt);
  updateFaces(state, dt);
  updateBullets(state, dt);

  resolveBulletHits(state);
  resolveContact(state);
  resolveCaches(state);
  resolveRefills(state);
  resolveEnding(state);
}

/**
 * Hull refills, picked up by flying through them.
 *
 * Deliberately refuses to top up a full hull. Wasting a lifeline you did not
 * need would be quietly infuriating on the run where you did, and leaving it
 * behind means it is still there when the diver two ridges ahead finds you.
 */
function resolveRefills(state: RunState): void {
  const player = state.player;
  if (player.health >= PLAYER_MAX_HEALTH) return;

  for (const refill of state.refills) {
    if (refill.taken) continue;
    if (!withinRange(player.x, player.y, refill.x, refill.y, REFILL_REACH + PLAYER_RADIUS)) {
      continue;
    }

    refill.taken = true;
    state.refillsTaken++;
    player.health = Math.min(PLAYER_MAX_HEALTH, player.health + REFILL_HEAL);

    state.emit({ kind: 'refill', text: `+${REFILL_HEAL} hull`, x: refill.x, y: refill.y });
    return;
  }
}

/**
 * Pick up anything you flew into.
 *
 * Banked immediately and never taken back. A cache is out of the ground the
 * moment you touch it, so dying afterwards costs you the extraction half of
 * your rescues and nothing here. That asymmetry is deliberate: a deep dive for
 * a vault should be a gamble on your hull, not a gamble on the reward.
 */
function resolveCaches(state: RunState): void {
  const player = state.player;

  for (const cache of state.caches) {
    if (cache.taken) continue;
    if (!withinRange(player.x, player.y, cache.x, cache.y, cacheReach(cache.tier) + PLAYER_RADIUS)) {
      continue;
    }

    cache.taken = true;
    state.cachesTaken++;
    state.cacheScore += cacheFace(cache.tier);
    if (cache.tier === 'relic') state.relicTaken = true;

    state.emit({
      kind: cache.tier === 'relic' ? 'relic' : 'cache',
      text: pickLine(state, cache.tier),
      x: cache.x,
      y: cache.y,
    });
  }
}

/** Cosmetic, so it draws from the run stream and never the level stream. */
function pickLine(state: RunState, tier: CacheTier): string {
  const lines = CACHE_LINES[tier];
  return lines[state.runRng.int(0, lines.length - 1)] ?? 'Recovered.';
}

function resolveBulletHits(state: RunState): void {
  const player = playerCircle(state);

  for (const bullet of state.bullets) {
    if (bullet.life <= 0) continue;
    const shot = { x: bullet.x, y: bullet.y, r: BULLET_RADIUS };

    if (bullet.friendly) {
      for (const enemy of state.enemies) {
        if (!enemy.alive || !enemy.active) continue;
        // Already been through this one. See the note on Bullet.pierced.
        if (bullet.pierced?.includes(enemy.id)) continue;
        if (!circlesOverlap(shot, { x: enemy.x, y: enemy.y, r: radiusOf(enemy) })) continue;

        damageEnemy(state, enemy, bullet.damage);

        // A piercing round carries on through the rest of the list rather than
        // stopping here, and remembers what it has been through so a survivor
        // it is still overlapping cannot be hit again on the next step.
        const pierce = bullet.pierce ?? 0;
        if (pierce > 0) {
          bullet.pierce = pierce - 1;
          bullet.pierced?.push(enemy.id);
          continue;
        }

        bullet.life = 0;
        break;
      }
      continue;
    }

    if (circlesOverlap(shot, player)) {
      damagePlayer(state, bullet.damage);
      bullet.life = 0;
    }
  }
}

/** Divers do their damage by arriving. They do not survive it either. */
function resolveContact(state: RunState): void {
  const player = playerCircle(state);

  for (const enemy of state.enemies) {
    if (!enemy.alive || !enemy.active || enemy.kind !== 'diver') continue;
    if (!circlesOverlap(player, { x: enemy.x, y: enemy.y, r: radiusOf(enemy) })) continue;

    damagePlayer(state, DIVER_CONTACT_DAMAGE);
    // Credit the kill. It read as a collision to the player either way, and
    // not crediting it makes ramming feel like a punishment with no upside.
    damageEnemy(state, enemy, enemy.health);
  }
}

/**
 * Exactly one ending, checked in severity order. Death outranks the clock and
 * the clock outranks the pad, so a player who is killed on the same step they
 * touch extraction is dead, not paid.
 */
function resolveEnding(state: RunState): void {
  // Belt and braces. damagePlayer already flips the phase when it empties the
  // hull, but the invariant that matters is "no health means the run is over",
  // and it should not depend on every future health writer remembering to set
  // the phase as well.
  if (state.player.health <= 0) state.phase = 'died';

  if (state.phase === 'died') {
    loseFollowers(state);
    return;
  }

  if (state.time >= state.seconds) {
    state.phase = 'timeout';
    loseFollowers(state);
    return;
  }

  if (atExtraction(state)) {
    state.phase = 'extracted';
    extractFollowers(state);
  }
}
