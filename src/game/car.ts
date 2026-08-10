/**
 * A car, in the city.
 *
 * ## Why this exists when the convoy did not work
 *
 * The chart-run transport failed twice because the player had no verb: it drove
 * itself and you tagged along. This one is the opposite. You drive it, it goes
 * nowhere without you, and it is genuinely better than being on foot in some
 * ways and genuinely worse in others.
 *
 * The trade is width. It is faster and it soaks damage that would have hit you,
 * but it is nearly twice as wide as a person, so gaps you can slip through on
 * foot are walls to it. A city built from price bars has plenty of those, and
 * which ones depends on the day. So "take the car or go on foot" is a real
 * question with a different answer each morning, rather than a strictly better
 * option you always pick.
 *
 * ## Getting out
 *
 * A dedicated key, not a direction. On a chart run "hold up" meant get out,
 * because up was not a direction you travelled. In a city every direction is a
 * direction, so leaving needs its own input or it would fight the steering.
 *
 * ## Determinism
 *
 * Position is a pure function of input and the layout. Nothing here draws from
 * either random stream.
 */

import { resolve } from './city';
import type { RunState } from './state';
import { damageEnemy, radiusOf } from './enemy';

export interface Car {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Which way it is pointing, so it can be drawn as a vehicle and not a box. */
  heading: number;
}

/**
 * Nearly twice a person's radius.
 *
 * This IS the mechanic. Make it the same size and the car is a strict upgrade
 * with no decision attached; make it much bigger and it cannot use the city at
 * all. Wide enough that some streets are foot-only, narrow enough that the main
 * avenues are always drivable.
 */
export const CAR_RADIUS = 32;

/*
 * Properly faster than walking, not marginally.
 *
 * It was 420 against 300 on foot, which is barely a difference and made the
 * walk over to it a worse deal than ignoring it. Then 760, which was a car in
 * an arcade rather than a car in a street: too fast to read a junction before
 * arriving at it. Five hundred against two hundred and forty on foot is a bit
 * over twice the pace, which is enough to be worth the walk and slow enough to
 * turn a corner on purpose.
 */
const CAR_THRUST = 1600;
const CAR_MAX_SPEED = 500;
/** Heavier than a person: it keeps going after you stop pushing. */
const CAR_DRAG_PER_SECOND = 0.28;

/** Below this it counts as parked, which is when the way out is offered. */
export const CAR_IDLE_SPEED = 60;

/** True when the car is stopped enough to step out of safely. */
export function carStopped(state: RunState): boolean {
  const car = state.car;
  if (!car) return false;
  return Math.hypot(car.vx, car.vy) <= CAR_IDLE_SPEED;
}

/** How close you have to be to get in. */
export const CAR_REACH = 70;

/**
 * Below this the car is parked as far as anybody standing in front of it is
 * concerned.
 *
 * Without a floor, rolling to a halt against somebody would grind them down at
 * walking pace and every enemy the car happened to be resting on would die for
 * free. A ram should be something you did on purpose.
 */
const RAM_SPEED = 220;

/**
 * Sized so nobody goes down in one pass.
 *
 * The weakest attacker on foot has 18 health and the toughest 28, so 16 puts
 * every one of them at two hits. That is the whole feel being asked for: the
 * first pass takes them off their feet, and you have to come back around. A
 * one-shot ram is not running somebody over, it is a delete button on wheels,
 * and it would make the car strictly better than the gun in every street.
 */
const RAM_DAMAGE = 16;

/**
 * How long before the same attacker can be hit again.
 *
 * Long enough that one drive-through is one hit rather than one per frame of
 * contact, and long enough that sitting on top of somebody with the throttle
 * open is not a kill either. Turning around is the cost of the second hit.
 */
const RAM_COOLDOWN = 1.1;

/** How hard a hit throws them, so the ram is visible and not just arithmetic. */
const RAM_SHOVE = 190;

/**
 * Speed kept through an impact.
 *
 * A ram costs momentum, so ploughing a line of attackers slows you to a crawl
 * and leaves you sitting still in the open. That is the trade: the car is a
 * weapon, but using it as one takes away the thing that made it safe.
 */
const RAM_SLOWDOWN = 0.55;
/** Seconds after getting out before the door works again. */
const REENTRY_LOCKOUT = 0.6;

export function makeCar(startX: number, startY: number): Car {
  return { x: startX, y: startY, vx: 0, vy: 0, heading: 0 };
}

/**
 * Drive. Called from updatePlayer while the player is at the wheel, so the car
 * and the person in it are moved by one piece of code and cannot disagree about
 * where they are.
 */
export function driveCar(state: RunState, dt: number, moveX: number, moveY: number): void {
  const car = state.car;
  const city = state.city;
  if (!car || !city) return;

  car.vx += moveX * CAR_THRUST * dt;
  car.vy += moveY * CAR_THRUST * dt;

  const damping = Math.pow(CAR_DRAG_PER_SECOND, dt);
  car.vx *= damping;
  car.vy *= damping;

  const speed = Math.hypot(car.vx, car.vy);
  if (speed > CAR_MAX_SPEED) {
    car.vx = (car.vx / speed) * CAR_MAX_SPEED;
    car.vy = (car.vy / speed) * CAR_MAX_SPEED;
  }

  // Resolve each axis separately. A diagonal correction can otherwise push the
  // car out of one building and into an adjacent one at a corner.
  const pushedX = resolve(city, car.x + car.vx * dt, car.y, CAR_RADIUS);
  if (pushedX.hit) {
    if (Math.abs(pushedX.x - (car.x + car.vx * dt)) > 0.01) car.vx = 0;
    car.x = pushedX.x;
  } else {
    car.x += car.vx * dt;
  }

  const pushedY = resolve(city, car.x, car.y + car.vy * dt, CAR_RADIUS);
  if (pushedY.hit) {
    if (Math.abs(pushedY.y - (car.y + car.vy * dt)) > 0.01) car.vy = 0;
    car.y = pushedY.y;
  } else {
    car.y += car.vy * dt;
  }

  car.x = Math.max(CAR_RADIUS, Math.min(city.width - CAR_RADIUS, car.x));
  car.y = Math.max(CAR_RADIUS, Math.min(city.height - CAR_RADIUS, car.y));

  // Only turn while actually moving, or a stationary car spins to face whatever
  // the stick was last touching, which reads as broken.
  if (speed > 24) car.heading = Math.atan2(car.vy, car.vx);

  ram(state, speed);
}

/**
 * Two tonnes moving at speed is a weapon whether or not it was meant to be.
 *
 * Driving through somebody and having them stand there unharmed was the single
 * loudest thing wrong with the city stages: the car reads as heavy, it is the
 * fastest thing in the level, and it bounced off people like a shopping trolley.
 *
 * Deliberately only on foot patrols. A turret is bolted to the ground and a
 * driven patrol is another car, so neither is something you flatten; leaving
 * them out keeps the car from being a way to skip every threat in the stage
 * without aiming at anything.
 */
function ram(state: RunState, speed: number): void {
  const car = state.car;
  if (!car || speed < RAM_SPEED) return;

  let struck = false;

  for (const enemy of state.enemies) {
    if (!enemy.alive || enemy.driving || enemy.kind === 'turret') continue;
    if (state.time < enemy.rammedUntil) continue;

    const reach = CAR_RADIUS + radiusOf(enemy);
    const dx = enemy.x - car.x;
    const dy = enemy.y - car.y;
    const distance = Math.hypot(dx, dy);
    if (distance > reach) continue;

    enemy.rammedUntil = state.time + RAM_COOLDOWN;
    damageEnemy(state, enemy, RAM_DAMAGE);

    /*
     * Thrown along the line of the impact.
     *
     * Without it a ram is a number changing somewhere off screen: the attacker
     * stands exactly where they were and the only tell is a health bar you are
     * not looking at while driving. Being knocked off the bonnet is what makes
     * the hit legible, and it also breaks the contact so the cooldown is not
     * the only thing keeping one pass to one hit.
     */
    const away = distance > 0.01 ? { x: dx / distance, y: dy / distance } : { x: 1, y: 0 };
    enemy.x += away.x * RAM_SHOVE * 0.12;
    enemy.y += away.y * RAM_SHOVE * 0.12;

    struck = true;
  }

  if (struck) {
    car.vx *= RAM_SLOWDOWN;
    car.vy *= RAM_SLOWDOWN;
    state.emit({ kind: 'hit', x: car.x, y: car.y });
  }
}

/** Get in, if there is one and you are on it. */
export function tryEnterCar(state: RunState): void {
  const car = state.car;
  if (!car || state.driving) return;
  if (state.time < state.remountAt) return;

  const player = state.player;
  if (Math.hypot(player.x - car.x, player.y - car.y) > CAR_REACH) return;

  state.driving = true;
  state.emit({ kind: 'refill', x: car.x, y: car.y, text: 'At the wheel' });
}

/** Get out. Sets the lockout so the door does not immediately grab you back. */
export function leaveCar(state: RunState): void {
  if (!state.driving) return;

  state.driving = false;
  state.remountAt = state.time + REENTRY_LOCKOUT;

  const car = state.car;
  const player = state.player;
  if (car) {
    // Step out to the side rather than the middle, so you are not standing in
    // the thing you just left and instantly back inside its collision.
    player.x = car.x + Math.cos(car.heading + Math.PI / 2) * (CAR_RADIUS + 18);
    player.y = car.y + Math.sin(car.heading + Math.PI / 2) * (CAR_RADIUS + 18);
    player.vx = 0;
    player.vy = 0;
  }

  state.emit({ kind: 'lost', x: player.x, y: player.y, text: 'On foot' });
}
