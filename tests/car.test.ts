/**
 * The car in the city.
 *
 * The chart-run transport failed twice because the player had no verb: it drove
 * itself and you tagged along. This one is the opposite, and the tests here pin
 * the two properties that make it a decision rather than a strict upgrade: you
 * have to ask for it, and it does not fit everywhere you do.
 */

import { describe, expect, it } from 'vitest';

import { practiceMission } from '../src/game/mission';
import { RunState } from '../src/game/state';
import { step } from '../src/game/update';
import { CAR_RADIUS, CAR_REACH } from '../src/game/car';
import { PLAYER_RADIUS } from '../src/game/player';
import { resolve, solidAt } from '../src/game/city';
import type { PlayerCommand } from '../src/game/player';

const STILL: PlayerCommand = { moveX: 0, moveY: 0, aimX: null, aimY: null, firing: false };
const GO: PlayerCommand = { moveX: 1, moveY: -0.4, aimX: null, aimY: null, firing: false };

function city() {
  const state = new RunState(practiceMission('2026-07-29'), 'sidearm', 5);
  state.enemies.length = 0;
  return state;
}

/** Stand on the car and ask to get in. */
function boardCar(state: RunState) {
  const car = state.car!;
  state.player.x = car.x;
  state.player.y = car.y;
  state.useRequested = true;
  step(state, 1 / 60, STILL);
  return car;
}

describe('a city has a car and a chart run does not', () => {
  it('is present only where there is a city', () => {
    expect(city().car).not.toBeNull();
    expect(new RunState(practiceMission('2026-07-29'), 'sidearm', 1).car).toBeNull();
  });

  it('is parked away from the start, so walking to it is the first choice', () => {
    const state = city();
    const gap = Math.hypot(state.car!.x - state.city!.startX, state.car!.y - state.city!.startY);
    expect(gap).toBeGreaterThan(CAR_REACH);
  });

  it('is not parked inside a building', () => {
    const state = city();
    expect(resolve(state.city!, state.car!.x, state.car!.y, CAR_RADIUS).hit).toBe(false);
  });
});

describe('you have to ask', () => {
  it('does not put you behind the wheel for walking past', () => {
    const state = city();
    const car = state.car!;
    state.player.x = car.x;
    state.player.y = car.y;

    for (let i = 0; i < 60; i++) step(state, 1 / 60, STILL);
    expect(state.driving).toBe(false);
  });

  it('gets in when asked, from close enough', () => {
    const state = city();
    boardCar(state);
    expect(state.driving).toBe(true);
  });

  it('will not get in from across the street', () => {
    const state = city();
    const car = state.car!;
    state.player.x = car.x + CAR_REACH * 4;
    state.player.y = car.y;
    state.useRequested = true;
    step(state, 1 / 60, STILL);
    expect(state.driving).toBe(false);
  });

  it('gets out when asked, and stays out', () => {
    const state = city();
    boardCar(state);

    state.useRequested = true;
    step(state, 1 / 60, STILL);
    expect(state.driving).toBe(false);

    // The lockout, without which the door grabs you straight back.
    for (let i = 0; i < 30; i++) step(state, 1 / 60, STILL);
    expect(state.driving).toBe(false);
  });

  it('puts you down beside it rather than inside it', () => {
    const state = city();
    const car = boardCar(state);
    state.useRequested = true;
    step(state, 1 / 60, STILL);

    const gap = Math.hypot(state.player.x - car.x, state.player.y - car.y);
    expect(gap).toBeGreaterThan(CAR_RADIUS);
    expect(solidAt(state.city!, state.player.x, state.player.y)).toBe(false);
  });
});

describe('driving it', () => {
  it('moves the car and carries the driver', () => {
    const state = city();
    const car = boardCar(state);
    const from = { x: car.x, y: car.y };

    for (let i = 0; i < 180; i++) step(state, 1 / 60, GO);

    expect(Math.hypot(car.x - from.x, car.y - from.y)).toBeGreaterThan(100);
    expect(state.player.x).toBeCloseTo(car.x, 0);
    expect(state.player.y).toBeCloseTo(car.y, 0);
  });

  it('never drives through a building', () => {
    const state = city();
    const car = boardCar(state);

    for (let i = 0; i < 900; i++) {
      step(state, 1 / 60, GO);
      expect(resolve(state.city!, car.x, car.y, CAR_RADIUS).hit).toBe(false);
    }
  });
});

describe('it does not fit everywhere you do', () => {
  it('is wide enough that some gaps are foot only', () => {
    // The whole trade. Same size and it is a strict upgrade with no decision.
    expect(CAR_RADIUS).toBeGreaterThan(PLAYER_RADIUS * 1.5);
  });

  it('is blocked in places a person is not', () => {
    const state = city();
    const c = state.city!;

    // Sweep the map and count spots that take a person but not the car.
    let footOnly = 0;
    for (let x = 40; x < c.width; x += 60) {
      for (let y = 40; y < c.height; y += 60) {
        const person = resolve(c, x, y, PLAYER_RADIUS).hit;
        const vehicle = resolve(c, x, y, CAR_RADIUS).hit;
        if (!person && vehicle) footOnly++;
      }
    }
    expect(footOnly).toBeGreaterThan(0);
  });
});

describe('driving stays settleable', () => {
  it('takes the same line from the same input on one seed', () => {
    const a = city();
    const b = city();
    boardCar(a);
    boardCar(b);

    const traceA: string[] = [];
    const traceB: string[] = [];
    for (let i = 0; i < 300; i++) {
      const command: PlayerCommand = {
        moveX: Math.sin(i / 33),
        moveY: Math.cos(i / 47),
        aimX: null,
        aimY: null,
        firing: i % 9 === 0,
      };
      step(a, 1 / 60, command);
      step(b, 1 / 60, command);
      traceA.push(`${a.car!.x.toFixed(4)}:${a.car!.y.toFixed(4)}`);
      traceB.push(`${b.car!.x.toFixed(4)}:${b.car!.y.toFixed(4)}`);
    }
    expect(traceA).toEqual(traceB);
  });
});
