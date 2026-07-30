/**
 * One fixed step of the run. This is the only place the order of operations
 * lives, and the order matters more than any single system in it.
 *
 * Movement first, then collisions against the positions everything actually
 * ended the step at, then end conditions last so a hit that kills you and an
 * extraction on the same step cannot both resolve. Resolving both is how you
 * get a run that reports a death and a payout together.
 */

import { ALLY_REACH, followAllies, reachableX, recruited } from './ally';
import { updateNodes } from './node';
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
import { earn } from './scrip';
import { updateSight } from './sight';
import { CONVOY_RADIUS, damageConvoy, updateConvoy } from './convoy';
import { tryMount } from './player';
import { leaveCar, tryEnterCar } from './car';

export function step(state: RunState, dt: number, command: PlayerCommand): void {
  if (state.finished) return;

  state.time += dt;

  updatePlayer(state, dt, command);
  // Before the attackers move, so a watcher that just woke the level does not
  // also get a free frame of shooting from its new alert state.
  updateSight(state, dt);
  /*
   * Only when nobody is at the wheel.
   *
   * updatePlayer already drove it this frame if the player is in it, and this
   * call passes zero, so running it unconditionally overwrote the driven state
   * and the HUD read STALLED the entire time somebody was driving.
   */
  // A city car is entered by asking, not by touching, so a player walking past
  // one is not silently put behind the wheel.
  if (state.city && state.useRequested) {
    state.useRequested = false;
    if (state.driving) leaveCar(state);
    else tryEnterCar(state);
  }

  if (!state.driving) {
    updateConvoy(state, dt, 0);
    // Touching it climbs in, the same way touching a person frees them. One
    // verb for "make contact with the thing" across the whole game.
    tryMount(state, dt);
  }
  updateNodes(state);
  updateEnemies(state, dt);
  updateFaces(state, dt);
  updateBullets(state, dt);

  followAllies(state, dt);
  resolveAllies(state);
  resolveBulletHits(state);
  resolveContact(state);
  resolveCaches(state);
  resolveRefills(state);
  resolveEnding(state);
}

/**
 * Recruiting the projects still standing, and being stopped by the seals.
 *
 * The clamp is applied after the player has moved rather than as a collision,
 * so pressing against a closed seal feels like leaning on a door instead of
 * catching on geometry. Velocity is killed on contact too, or the ship keeps
 * its momentum and springs away the moment the seal opens.
 */
function resolveAllies(state: RunState): void {
  if (state.allies.length === 0) return;

  const player = state.player;

  for (const ally of state.allies) {
    if (ally.recruited) continue;
    if (!withinRange(player.x, player.y, ally.x, ally.y, ALLY_REACH + PLAYER_RADIUS)) continue;

    ally.recruited = true;
    ally.joinedAt = state.time;
    ally.slot = recruited(state.allies);
    state.lastJoinAt = state.time;

    /*
     * Named in the event, because the name is the point.
     *
     * The whole stage rests on these being real projects a player recognises,
     * and a generic "ally joined" would throw that away at the one moment it
     * lands hardest.
     */
    state.emit({
      kind: 'freed',
      x: ally.x,
      y: ally.y,
      text: `${ally.ticker} joins`,
    });
  }

  const limit = reachableX(state.seals, state.allies, player.x);
  if (player.x > limit) {
    player.x = limit;
    if (player.vx > 0) player.vx = 0;
  }
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
    // Scrip on top of the Face. The Face is the permanent record; this is the
    // money you can actually use before the run ends.
    earn(state.purse, cache.scrip);
    state.cacheScrip += cache.scrip;
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
        /*
         * Alive is the only requirement. Awake is NOT.
         *
         * This used to also demand `enemy.active`, which on a chart run was
         * invisible: an attacker wakes as soon as you are within eight hundred
         * units, which is further than any round travels, so everything you
         * could reach was already awake.
         *
         * In a city it made unaware patrols bulletproof. A patrol only becomes
         * active once it has SENSED you, so anyone you had not been noticed by
         * absorbed rounds and shrugged. Worse, it made the car look like the
         * cause: driving senses you from seven hundred and sixty away and
         * notices in half the time, so climbing in woke the street and suddenly
         * everything was killable. Reported from a playtest as only being able
         * to kill them from the car, which is exactly how it behaved.
         *
         * A bullet that hits a person hurts them whether or not they were paying
         * attention. Shooting first is the reward for not being seen, not a
         * thing the game refuses to let you do.
         */
        if (!enemy.alive) continue;
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
      continue;
    }

    /*
     * The transport is hittable by anything that missed the player.
     *
     * Checked second rather than first: a shot that would have hit both should
     * hurt the person who can dodge, not the thing that cannot. Otherwise a
     * player flying escort directly over the cargo would act as a shield by
     * standing still, which is the opposite of the intended pressure.
     */
    const convoy = state.convoy;
    if (convoy && !convoy.arrived && convoy.health > 0) {
      if (circlesOverlap(shot, { x: convoy.x, y: convoy.y, r: CONVOY_RADIUS })) {
        damageConvoy(state, bullet.damage);
        bullet.life = 0;
      }
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
    /*
     * On an escort stage, arriving is not finishing.
     *
     * The mission is to get the cargo through, so a player who sprints to the
     * pad and waits has done the easy half. They hold at the pad until the
     * transport catches up, which is exactly the pressure the stage is for: the
     * last stretch is the one where the thing you are protecting is furthest
     * behind you.
     */
    const convoy = state.convoy;
    if (convoy && !convoy.arrived) return;

    /*
     * On a reading stage, arriving is not finishing either.
     *
     * Without this the stage is stage five with panels on the walls: you could
     * drive past every node, reach the exit and clear it having read nothing,
     * which is precisely the "every stage is the same run in a different
     * colour" complaint the later stages exist to answer. The reads ARE the
     * mission, so the way out stays shut until they are done.
     *
     * Guarded on the list being non-empty rather than on the stage flag, so a
     * day too quiet to supply four sourced posts leaves the exit open instead
     * of leaving the stage unfinishable.
     */
    if (state.nodes.length > 0 && state.nodesCaptured < state.nodes.length) return;

    /*
     * The last stage does not end without everyone.
     *
     * The seals already make it impossible to reach the pad having skipped one,
     * so this is belt and braces rather than the mechanism. It matters because
     * the pad is the finale of the whole campaign, and arriving at it a project
     * short should not quietly count as freeing crypto.
     */
    if (state.allies.length > 0 && recruited(state.allies) < state.allies.length) return;

    state.phase = 'extracted';
    extractFollowers(state);
  }
}
