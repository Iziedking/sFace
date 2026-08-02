/**
 * How attackers behave in a city.
 *
 * ## Why the chart behaviour does not transfer
 *
 * On a chart run every attacker is defined against a ground line and a single
 * forward axis: drifters close the horizontal gap, turrets sit rooted on the
 * ground, runners chase along it, divers fall. In a city there is no ground and
 * no forward, so all four are nonsense. Worse, waking was keyed to
 * `enemy.x - player.x`, which in a map five thousand wide woke a vertical strip
 * of the city rather than the part you were standing in. From inside, that
 * reads as an empty city where nothing ever comes.
 *
 * ## What replaces it
 *
 * People with jobs. They walk their patch, and they are not hunting you. They
 * only become a threat once they have SENSED you, and until then you can walk
 * past one at the far end of a street and it will keep walking.
 *
 * That turns a city fight into a question of exposure rather than aim. Every
 * corner is a decision about whether the thing on the other side of it has
 * noticed yet.
 *
 * ## The car is loud
 *
 * Sensing is the whole reason the car is a real choice rather than a strictly
 * faster one. On foot you are quiet and hard to place. In the car you are
 * sensed from much further away and much faster, so speed costs you surprise.
 * That is the trade: cross the map quickly and arrive with everyone already
 * looking at you, or take the long way on foot and pick your moment.
 *
 * ## Determinism
 *
 * Patrols turn on geometry and the run clock. Firing cadence draws from the run
 * stream in enemy order, exactly as the chart behaviours do, so two players who
 * move identically see identical behaviour.
 */

import { resolve } from './city';
import { PATROL_CAR_RADIUS } from './enemy';
import { lineBlocked } from './city';
import { resolve as resolveRings, solidAt as ringSolidAt } from './rings';
import { spawnBullet } from './bullet';
import type { Enemy, RunState } from './state';

/** How fast a patrol walks. Slower than the player on foot, by design. */
const PATROL_SPEED = 96;
/** How fast one moves once it has seen you and is closing. */
const ENGAGE_SPEED = 150;

/**
 * How much faster the ones in cars are.
 *
 * Deliberately under the player's own car at 500. A patrol car that outran you
 * would turn every sighting into a fight you cannot leave, which removes the
 * choice the whole city is built around. At this multiple it closes on you when
 * you are on foot and loses ground when you drive, so the answer to a patrol car
 * depends on which you are doing.
 */
const CAR_SPEED_SCALE = 2.4;

/**
 * How much further a car-borne patrol can sense.
 *
 * It is looking out of a moving vehicle down a straight street, so it sees a
 * long way and notices quickly. The counterweight is that it is loud and big:
 * you hear it coming and you can hit it from anywhere.
 */
const CAR_SENSE_SCALE = 1.35;

/** How far a patrol can sense somebody on foot. */
const SENSE_ON_FOOT = 330;
/**
 * How far it senses somebody in a car.
 *
 * More than double. This is the number that makes driving a decision: the car
 * crosses the map in a third of the time and announces you the whole way.
 */
const SENSE_IN_CAR = 760;

/** Seconds of exposure before a patrol reacts. Halved when you are driving. */
const NOTICE_SECONDS = 0.55;

/** How long it keeps coming after losing sight of you. */
const PURSUE_SECONDS = 4;

const SHOT_SPEED = 430;
const SHOT_DAMAGE = 9;

export function senseRange(state: RunState, enemy?: Enemy): number {
  const base = state.driving ? SENSE_IN_CAR : SENSE_ON_FOOT;
  return enemy?.driving ? base * CAR_SENSE_SCALE : base;
}

/** True when this attacker currently has a clear line to the player. */
export function canSense(state: RunState, enemy: Enemy): boolean {
  const world = state.freeWorld;
  if (!world) return false;

  const player = state.player;
  const distance = Math.hypot(player.x - enemy.x, player.y - enemy.y);
  if (distance > senseRange(state, enemy)) return false;

  // Walls hide you. Both worlds are made of cover and it has to mean something.
  return !blocked(state, enemy.x, enemy.y, player.x, player.y);
}

/**
 * Is there something solid between these two points?
 *
 * A city answers this from its own blocks. The ring city has no blocks, only
 * concentric walls, so the line is sampled against them instead: cheap, and
 * accurate enough for deciding whether somebody can see you when the walls are
 * hundreds of units thick.
 *
 * Sampled rather than solved because a ray against a set of arcs is real work
 * for a question asked once per attacker per frame, and being a few units wrong
 * about where a wall starts changes nothing about the answer.
 */
function blocked(
  state: RunState,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): boolean {
  if (state.city) return lineBlocked(state.city, fromX, fromY, toX, toY);

  const rings = state.rings;
  if (!rings) return false;

  const dx = toX - fromX;
  const dy = toY - fromY;
  const span = Math.hypot(dx, dy);
  if (span < 1) return false;

  // A step well under the thinnest wall, so nothing is stepped over.
  const steps = Math.min(48, Math.max(4, Math.ceil(span / 40)));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (ringSolidAt(rings, fromX + dx * t, fromY + dy * t)) return true;
  }
  return false;
}

/**
 * One attacker's turn, in a city.
 *
 * Three states, and no state machine: a patrol is simply one that has not
 * noticed you yet, and a pursuer is one whose memory has not run out. Holding
 * that in two numbers rather than an enum keeps the transitions impossible to
 * get wrong.
 */
export function updatePatrol(state: RunState, enemy: Enemy, dt: number): void {
  const world = state.freeWorld;
  if (!world || !enemy.alive) return;

  const player = state.player;
  const sensed = canSense(state, enemy);

  if (sensed) {
    // Driving is louder, so it takes half the exposure to be clocked.
    enemy.notice += dt / (state.driving ? NOTICE_SECONDS * 0.5 : NOTICE_SECONDS);
    if (enemy.notice >= 1) {
      enemy.notice = 1;
      enemy.alertUntil = state.time + PURSUE_SECONDS;
      if (!enemy.active) {
        enemy.active = true;
        state.emit({ kind: 'hit', x: enemy.x, y: enemy.y });
      }
    }
  } else {
    // Forgetting is slower than noticing, so breaking line of sight buys time
    // rather than instantly resetting the encounter.
    enemy.notice = Math.max(0, enemy.notice - dt * 0.4);
  }

  const engaged = state.time < enemy.alertUntil;

  if (engaged) {
    // Close, but not all the way: they want a shot, not a hug.
    const dx = player.x - enemy.x;
    const dy = player.y - enemy.y;
    const distance = Math.hypot(dx, dy) || 1;

    const closing = enemy.driving ? ENGAGE_SPEED * CAR_SPEED_SCALE : ENGAGE_SPEED;
    if (distance > 190) {
      enemy.x += (dx / distance) * closing * dt;
      enemy.y += (dy / distance) * closing * dt;
    }

    if (sensed) fireAt(state, enemy, dt, dx / distance, dy / distance);
  } else {
    walkPatch(enemy, dt);
  }

  /*
   * Pushed out of whatever is solid here.
   *
   * The two worlds answer this differently: a city has blocks, the ring city
   * has concentric walls. Both hand back the same shape, so the rest of the
   * patrol does not need to know which one it is standing in.
   */
  const radius = enemy.driving ? PATROL_CAR_RADIUS : 18;
  const pushed = state.city
    ? resolve(state.city, enemy.x, enemy.y, radius)
    : state.rings
      ? resolveRings(state.rings, enemy.x, enemy.y, radius)
      : { x: enemy.x, y: enemy.y, hit: false };
  if (pushed.hit) {
    enemy.x = pushed.x;
    enemy.y = pushed.y;
    // Bounced off a wall while patrolling: turn rather than grind along it.
    if (!engaged) enemy.patrolHeading += Math.PI / 2;
  }

  const edge = enemy.driving ? PATROL_CAR_RADIUS : 18;
  enemy.x = Math.max(edge, Math.min(world.width - edge, enemy.x));
  enemy.y = Math.max(edge, Math.min(world.height - edge, enemy.y));
}

/** Walking, or driving, the patch. Unbothered either way. */
function walkPatch(enemy: Enemy, dt: number): void {
  const speed = enemy.driving ? PATROL_SPEED * CAR_SPEED_SCALE : PATROL_SPEED;
  enemy.x += Math.cos(enemy.patrolHeading) * speed * dt;
  enemy.y += Math.sin(enemy.patrolHeading) * speed * dt;
}

function fireAt(state: RunState, enemy: Enemy, dt: number, ux: number, uy: number): void {
  enemy.fireCooldown -= dt;
  if (enemy.fireCooldown > 0) return;

  spawnBullet(state, {
    x: enemy.x + ux * 20,
    y: enemy.y + uy * 20,
    vx: ux * SHOT_SPEED,
    vy: uy * SHOT_SPEED,
    life: 1.6,
    damage: SHOT_DAMAGE,
    friendly: false,
    pierce: 0,
  });

  // From the run stream, in enemy order, so a challenge still settles.
  enemy.fireCooldown = state.runRng.range(0.9, 1.7);
}
