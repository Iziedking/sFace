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

  car.x += car.vx * dt;
  car.y += car.vy * dt;

  const pushed = resolve(city, car.x, car.y, CAR_RADIUS);
  if (pushed.hit) {
    if (Math.abs(pushed.x - car.x) > 0.01) car.vx = 0;
    if (Math.abs(pushed.y - car.y) > 0.01) car.vy = 0;
    car.x = pushed.x;
    car.y = pushed.y;
  }

  car.x = Math.max(CAR_RADIUS, Math.min(city.width - CAR_RADIUS, car.x));
  car.y = Math.max(CAR_RADIUS, Math.min(city.height - CAR_RADIUS, car.y));

  // Only turn while actually moving, or a stationary car spins to face whatever
  // the stick was last touching, which reads as broken.
  if (speed > 24) car.heading = Math.atan2(car.vy, car.vx);
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
