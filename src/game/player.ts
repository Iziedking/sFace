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

import { steerAim } from './assist';
import { clamp, direction, groundPenetration } from './collision';
import { updateConvoy } from './convoy';
import { resolve as resolveCity } from './city';
import { resolve as resolveRings } from './rings';
import { driveCar } from './car';
import { spawnBullet, BULLET_RADIUS } from './bullet';
import { fireRateScale, recoilScale } from './consume';
import type { Weapon } from '../data/weapons';
import type { RunState } from './state';
import { PLAYER_MAX_HEALTH } from './state';
import { CEILING, WORLD_WIDTH } from './terrain';

export const PLAYER_RADIUS = 17;

const THRUST = 1750;
const GRAVITY = 640;
/** Fraction of velocity kept per second. Low number, snappy ship. */
const DRAG_PER_SECOND = 0.02;
export const MAX_SPEED = 335;
const MUZZLE_OFFSET = 20;

/** Below this impact speed, touching the ground is free. */
const SAFE_LANDING_SPEED = 260;
const CRASH_DAMAGE_PER_SPEED = 0.14;
/*
 * The window is what actually bounds the damage, not the per-bullet number.
 *
 * Several attackers firing at once land within a few frames of each other, so
 * without a wide enough window a crossfire takes a third of the hull in an
 * instant and there is no moment in which the player could have reacted. At
 * 0.6 the ceiling was about eighteen a second; at 0.85 with the lower round it
 * is about nine, which leaves time to get behind something.
 */
const INVULNERABLE_SECONDS = 0.85;

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

  /*
   * At the wheel: no flight at all.
   *
   * Returning early rather than blending the two is the whole reason driving
   * feels different. A car that still had thrust, drag and a jetpack would be a
   * ship with a picture of a car on it, which is exactly the objection that
   * made the first two versions of this stage fail.
   */
  if (state.driving) {
    // A city car and a chart transport are different vehicles with different
    // physics, so they get different code rather than one function with a flag.
    if (state.city) driveInCity(state, dt, command);
    else drive(state, dt, command);
    return;
  }

  /*
   * In a city there is no down.
   *
   * Gravity, hard landings and a ceiling are all statements about a world with
   * one ground line under it. A street has walls on four sides and no floor to
   * fall onto, so flight physics here is a top-down glide: thrust in any
   * direction, drag, and buildings you cannot pass through.
   */
  if (state.city) {
    walkCity(state, dt, command);
    return;
  }

  /*
   * The ring city flies the same way a street does, and collides differently.
   *
   * Same top-down glide, because a world with no ground line has no reason for
   * gravity whichever shape it is. What changes is what stops you: rings rather
   * than boxes, pushed out radially. See game/rings.ts.
   */
  if (state.rings) {
    flyRings(state, dt, command);
    return;
  }

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

/**
 * Moving through a city.
 *
 * The same thrust and drag as flight, minus gravity and the ground, plus walls.
 * Keeping the acceleration model identical matters: a player who has flown four
 * stages already knows how this responds, and a city that handled differently
 * for no reason would be a second control scheme to learn rather than a second
 * place to be.
 */
/**
 * Flying the ring city.
 *
 * Deliberately a touch faster than the street, because the finale is a long
 * circling stage and a wall you have to fly a quarter of the way around is a
 * wall you should not be crawling past.
 */
function flyRings(state: RunState, dt: number, command: PlayerCommand): void {
  const player = state.player;
  const rings = state.rings;
  if (!rings) return;

  player.vx += command.moveX * CITY_THRUST * 1.15 * dt;
  player.vy += command.moveY * CITY_THRUST * 1.15 * dt;

  const damping = Math.pow(DRAG_PER_SECOND, dt);
  player.vx *= damping;
  player.vy *= damping;

  const top = CITY_MAX_SPEED * 1.2;
  const speed = Math.hypot(player.vx, player.vy);
  if (speed > top) {
    player.vx = (player.vx / speed) * top;
    player.vy = (player.vy / speed) * top;
  }

  player.x += player.vx * dt;
  player.y += player.vy * dt;

  const pushed = resolveRings(rings, player.x, player.y, PLAYER_RADIUS);
  if (pushed.hit) {
    /*
     * Kill only the speed into the wall.
     *
     * A ring is curved, so the useful direction along it is the tangent. Zeroing
     * the whole velocity would stop you dead every time you brushed a wall while
     * circling it, which is most of this stage.
     */
    const nx = (player.x - rings.cx) / (Math.hypot(player.x - rings.cx, player.y - rings.cy) || 1);
    const ny = (player.y - rings.cy) / (Math.hypot(player.x - rings.cx, player.y - rings.cy) || 1);
    const into = player.vx * nx + player.vy * ny;
    player.vx -= nx * into;
    player.vy -= ny * into;

    player.x = pushed.x;
    player.y = pushed.y;
  }

  player.x = Math.max(20, Math.min(rings.width - 20, player.x));
  player.y = Math.max(20, Math.min(rings.height - 20, player.y));

  player.facing = player.vx >= 0 ? 1 : -1;
}

function walkCity(state: RunState, dt: number, command: PlayerCommand): void {
  const player = state.player;
  const city = state.city;
  if (!city) return;

  player.vx += command.moveX * CITY_THRUST * dt;
  player.vy += command.moveY * CITY_THRUST * dt;

  const damping = Math.pow(DRAG_PER_SECOND, dt);
  player.vx *= damping;
  player.vy *= damping;

  const speed = Math.hypot(player.vx, player.vy);
  if (speed > CITY_MAX_SPEED) {
    player.vx = (player.vx / speed) * CITY_MAX_SPEED;
    player.vy = (player.vy / speed) * CITY_MAX_SPEED;
  }

  player.x += player.vx * dt;
  player.y += player.vy * dt;

  // Walls, then the edge of the map. In that order, so being pushed out of a
  // building can never push you outside the world.
  const pushed = resolveCity(city, player.x, player.y, PLAYER_RADIUS);
  if (pushed.hit) {
    // Kill the velocity into the wall rather than all of it, so a glancing
    // contact slides along the face instead of stopping you dead.
    if (Math.abs(pushed.x - player.x) > 0.01) player.vx = 0;
    if (Math.abs(pushed.y - player.y) > 0.01) player.vy = 0;
    player.x = pushed.x;
    player.y = pushed.y;
  }

  player.x = clamp(player.x, PLAYER_RADIUS, city.width - PLAYER_RADIUS);
  player.y = clamp(player.y, PLAYER_RADIUS, city.height - PLAYER_RADIUS);

  if (Math.abs(player.vx) > 12) player.facing = player.vx > 0 ? 1 : -1;

  aim(state, command);
  fire(state, dt, command);
  recordTrail(state);
}

/**
 * At the wheel, in a city.
 *
 * The car moves and the driver is carried. Aiming and firing still work, so
 * steering and shooting compete for the same attention, which is the whole
 * reason driving is a different job rather than a faster one.
 */
function driveInCity(state: RunState, dt: number, command: PlayerCommand): void {
  const car = state.car;
  if (!car) {
    state.driving = false;
    return;
  }

  driveCar(state, dt, command.moveX, command.moveY);

  const player = state.player;
  player.x = car.x;
  player.y = car.y;
  player.vx = 0;
  player.vy = 0;
  if (Math.abs(car.vx) > 12) player.facing = car.vx > 0 ? 1 : -1;

  aim(state, command);
  fire(state, dt, command);
  recordTrail(state);
}

/**
 * Slightly gentler than flight, because there is no gravity to fight.
 *
 * Two hundred and forty rather than three hundred, so the car at five hundred
 * is a bit over twice the pace. The gap has to be felt for walking to the car
 * to be a decision, and it has to be small enough that going on foot is still
 * a real option rather than a penalty.
 */
const CITY_THRUST = 1250;
const CITY_MAX_SPEED = 240;

/**
 * How close you have to be to climb in.
 *
 * Generous, because mounting is not the skill being tested and fumbling it
 * under fire would be a tax on the wrong thing.
 */
const MOUNT_REACH = 74;

/** Push given on the way out, so leaving is a hop rather than a fall. */
const DISMOUNT_LIFT = -300;

/**
 * How long after climbing out before you can climb back in.
 *
 * Without it, getting out is impossible: the dismount clears the flag, the very
 * next frame finds the player still within reach of the seat they just left,
 * and puts them straight back in it. The hop alone is not enough, because the
 * check runs before the player has moved anywhere.
 */
const REMOUNT_LOCKOUT = 0.7;

/**
 * Driving.
 *
 * The horizontal axis steers and the vertical axis is the door: hold up and you
 * climb out. That reuses the stick and the keys the player already has, so
 * there is no new control to teach, and it maps to the intuition that up means
 * out of the vehicle and into the air.
 *
 * The gun still works from the seat, which is the point: steering and aiming
 * compete for the same thumb.
 */
function drive(state: RunState, dt: number, command: PlayerCommand): void {
  const player = state.player;
  const convoy = state.convoy;

  if (!convoy || convoy.health <= 0) {
    state.driving = false;
    return;
  }

  // Out. Checked before the drive so a player bailing does not also lurch the
  // vehicle a frame's worth in whatever direction they were leaning.
  if (command.moveY < -0.5) {
    state.driving = false;
    state.remountAt = state.time + REMOUNT_LOCKOUT;
    player.vy = DISMOUNT_LIFT;
    player.vx = 0;
    return;
  }

  updateConvoy(state, dt, command.moveX);

  // Riding, not flying: the seat decides where you are.
  player.x = convoy.x;
  player.y = convoy.y - PLAYER_RADIUS - 6;
  player.vx = 0;
  player.vy = 0;
  if (Math.abs(command.moveX) > 0.1) player.facing = command.moveX > 0 ? 1 : -1;

  aim(state, command);
  fire(state, dt, command);
  recordTrail(state);
}

/** Climb in, if there is something to climb into and you are on it. */
export function tryMount(state: RunState, _dt: number): void {
  const convoy = state.convoy;
  if (!convoy || state.driving || convoy.arrived || convoy.health <= 0) return;
  if (state.time < state.remountAt) return;

  const player = state.player;
  const near = Math.hypot(player.x - convoy.x, player.y - convoy.y) <= MOUNT_REACH;
  if (!near) return;

  state.driving = true;
  state.emit({ kind: 'refill', x: convoy.x, y: convoy.y, text: 'At the wheel' });
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

/** Below this stick deflection the player has not implied a direction. */
const AIM_INTENT = 0.15;

/**
 * Point the gun.
 *
 * An explicit aim always wins. With none, the gun follows the direction of
 * flight rather than holding still, and that fallback is the fix for the worst
 * bug this game had: a player flying on the keyboard with an untouched mouse
 * gave no aim input at all, so the gun stayed at its initial heading and fired
 * due right for a whole run. Anything above or behind you was unkillable and
 * it read as the gun being broken, which it effectively was.
 *
 * This lives in the simulation rather than in the input layer on purpose. It
 * is a rule about how the ship behaves, so it should hold for every source of
 * a command, including a replay, not only for the one path that happens to
 * build commands from a live pointer.
 */
function aim(state: RunState, command: PlayerCommand): void {
  const player = state.player;

  if (command.aimX !== null && command.aimY !== null) {
    const unit = direction(player.x, player.y, command.aimX, command.aimY);
    // Assist bends where you pointed toward what you were nearly pointing at. It
    // is applied here, at the single place the gun's heading is decided, so every
    // input path gets it and nothing else has to know it exists.
    const helped = steerAim(state, unit.x, unit.y);
    player.aimX = helped.x;
    player.aimY = helped.y;
    return;
  }

  /*
   * Follow the thrust, not the velocity.
   *
   * Velocity was tried first and it is wrong: hovering means falling and
   * catching yourself over and over, so the gun swings at the floor every time
   * gravity gets a moment, and a stationary player watches their aim flap up
   * and down. Thrust is what the player actually asked for, so a hand off the
   * stick holds the last heading instead of drifting.
   */
  const intent = Math.hypot(command.moveX, command.moveY);
  if (intent < AIM_INTENT) return;

  // The fallback heading gets the same help. This is the path a keyboard player
  // and a phone player who has not touched the fire pad are both on, so leaving
  // it unassisted would mean assist only worked once you were already aiming
  // well.
  const drift = steerAim(state, command.moveX / intent, command.moveY / intent);
  player.aimX = drift.x;
  player.aimY = drift.y;
}

/**
 * Pull the trigger, in whatever shape the gun in hand has.
 *
 * Every number here comes off the weapon rather than out of this file, so a
 * scattergun and a lance are the same twenty lines with different constants.
 * That is deliberate: a second firing path would be a second place for the
 * recoil to be forgotten, and the recoil is half of what makes the lance a
 * trade rather than an upgrade.
 */
function fire(state: RunState, dt: number, command: PlayerCommand): void {
  const player = state.player;
  const weapon = state.weapon;
  player.fireCooldown -= dt;

  if (!command.firing || player.fireCooldown > 0) return;

  // Overdrive shortens the gap between shots. Scaled here rather than baked
  // into the weapon so the weapon stays a constant and the effect stays a
  // property of the run.
  player.fireCooldown = weapon.interval / fireRateScale(state);
  player.lastFiredAt = state.time;

  for (let index = 0; index < weapon.pellets; index++) {
    const angle = pelletAngle(weapon, index);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    // Rotate the aim direction rather than adding to an atan2 of it. Same
    // result, no trigonometry on a vector that is already a unit vector.
    const dx = player.aimX * cos - player.aimY * sin;
    const dy = player.aimX * sin + player.aimY * cos;

    spawnBullet(state, {
      x: player.x + dx * MUZZLE_OFFSET,
      y: player.y + dy * MUZZLE_OFFSET,
      vx: dx * weapon.speed + player.vx * 0.3,
      vy: dy * weapon.speed + player.vy * 0.3,
      life: weapon.life,
      damage: weapon.damage,
      friendly: true,
      pierce: weapon.pierce,
      // Only a round that can pierce needs somewhere to remember what it has
      // already been through, so nothing else pays for the array.
      pierced: weapon.pierce > 0 ? [] : undefined,
    });
  }

  // A kick backwards. It sells the gun, and on the heavier ones it is a real
  // cost: a lance fired while hovering will move you.
  // Recoil scales with the rate. A gun that fires twice as fast for free would
  // be a straight upgrade, and no consumable in this game is allowed to be one.
  const kick = weapon.recoil * recoilScale(state);
  player.vx -= player.aimX * kick;
  player.vy -= player.aimY * kick;
}

/**
 * Where one pellet of a pull goes, as an offset from the aim direction.
 *
 * The fan is fixed rather than random. A random spread means the same shot at
 * the same range sometimes kills and sometimes does not, and the player has no
 * way to tell which of those two things they just did. A fixed fan can be
 * learned, so closing the distance is a decision instead of a dice roll.
 */
function pelletAngle(weapon: Weapon, index: number): number {
  if (weapon.pellets < 2 || weapon.spread === 0) return 0;
  const across = index / (weapon.pellets - 1);
  return (across - 0.5) * 2 * weapon.spread;
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
