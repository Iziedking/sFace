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
import { circlesOverlap } from './collision';
import { damageEnemy, radiusOf, updateEnemies, DIVER_CONTACT_DAMAGE } from './enemy';
import { atExtraction, extractFollowers, loseFollowers } from './face';
import { updateFaces } from './face';
import { damagePlayer, playerCircle, updatePlayer, type PlayerCommand } from './player';
import { RUN_SECONDS, type RunState } from './state';

export function step(state: RunState, dt: number, command: PlayerCommand): void {
  if (state.finished) return;

  state.time += dt;

  updatePlayer(state, dt, command);
  updateEnemies(state, dt);
  updateFaces(state, dt);
  updateBullets(state, dt);

  resolveBulletHits(state);
  resolveContact(state);
  resolveEnding(state);
}

function resolveBulletHits(state: RunState): void {
  const player = playerCircle(state);

  for (const bullet of state.bullets) {
    if (bullet.life <= 0) continue;
    const shot = { x: bullet.x, y: bullet.y, r: BULLET_RADIUS };

    if (bullet.friendly) {
      for (const enemy of state.enemies) {
        if (!enemy.alive || !enemy.active) continue;
        if (!circlesOverlap(shot, { x: enemy.x, y: enemy.y, r: radiusOf(enemy) })) continue;

        damageEnemy(state, enemy, bullet.damage);
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

  if (state.time >= RUN_SECONDS) {
    state.phase = 'timeout';
    loseFollowers(state);
    return;
  }

  if (atExtraction(state)) {
    state.phase = 'extracted';
    extractFollowers(state);
  }
}
