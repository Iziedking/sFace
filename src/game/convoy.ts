/**
 * The transport, which you drive.
 *
 * ## Currently switched off on every stage
 *
 * This was stage five until the city replaced it. It is kept rather than
 * deleted because the city needs a car and this is most of one: the mount and
 * dismount, the seat, the cargo health, the "clears when the cargo arrives"
 * rule and the refusal to climb are all reusable. What has to change is the
 * movement, which assumes a single ground height per column and has to become
 * free movement in two axes with building collision.
 *
 * If a car in the city does not get built, delete this file rather than leaving
 * it here looking like a feature.
 *
 *
 * ## Two wrong versions before this one
 *
 * The first drove itself the whole route. In play it left: it got ahead, outran
 * the danger, arrived untouched and waited at the pad. A progress bar on wheels.
 *
 * The second stalled when the player ranged too far ahead, which sounded like a
 * fix and was not. The cover range was a full screen wide, so it could still be
 * off-screen ahead and rolling, and more importantly the player still had no
 * verb. "Fly near a thing" is a proximity check, not a mission. No amount of
 * tuning gives a stage a verb it does not have.
 *
 * So you drive it. That is the verb, and it is genuinely a different game
 * inside the same engine:
 *
 *   - It is heavy and grounded. It cannot dodge upward; it goes through.
 *   - Terrain that is scenery when you fly is an obstacle that stops it. A
 *     slope too steep to climb is a wall, and the chart decides where those are.
 *   - You shoot from it, so steering and aiming compete for the same attention.
 *   - Getting out to fly is a real decision, because it does not move without
 *     a driver and the clock does not stop.
 *
 * The objection to letting the player drive was that a vehicle under your
 * control is just a slower ship. That is only true if it handles like one. This
 * cannot climb, cannot rise, and cannot dodge, so the same terrain reads
 * completely differently from inside it.
 *
 * ## Determinism
 *
 * Position is a pure function of the player's input and the terrain, both of
 * which are already deterministic, so two players on one seed who drive the
 * same way arrive at the same place at the same instant.
 */

import type { RunState } from './state';
import type { Terrain } from './terrain';

export interface Convoy {
  x: number;
  y: number;
  health: number;
  /** Set once it reaches the pad. The stage clears on this, not on the player. */
  arrived: boolean;
  /** True while nobody is at the wheel. Drives the HUD, and it is the norm. */
  stalled: boolean;
  /** Blocked by ground too steep to climb. Shown, so it is not read as a bug. */
  blocked: boolean;
}

export const CONVOY_MAX_HEALTH = 100;
/** Half a face wide, so a bullet aimed at it does not need to be precise. */
export const CONVOY_RADIUS = 30;

/**
 * World units per second.
 *
 * Tuned against the stage clock rather than picked: it has to cover the whole
 * stage in comfortably less than the time allowed, or a perfect defence still
 * loses, which would make the mission unwinnable for reasons the player cannot
 * see. See convoySpeed.
 */
export function convoySpeed(extractionX: number, seconds: number): number {
  const start = START_X;
  const distance = Math.max(1, extractionX - start);
  /*
   * Half the clock at a flat run.
   *
   * It only moves while somebody is driving it, and nobody drives it for the
   * whole stage: you get out to clear a path, you get stopped by a slope, you
   * turn back. Half means a player who drives well has roughly the same time
   * again to spend on everything else, which is where the stage actually
   * happens.
   */
  return distance / (seconds * 0.5);
}

/** Where it sets off. Behind the player's start, so it is visible early. */
const START_X = 420;

export function makeConvoy(terrain: Terrain): Convoy {
  return {
    x: START_X,
    y: terrain.groundAt(START_X) - CONVOY_RADIUS,
    health: CONVOY_MAX_HEALTH,
    arrived: false,
    stalled: true,
    blocked: false,
  };
}

/**
 * The steepest rise it will climb, per unit travelled.
 *
 * This is the number that turns the chart into a road. A price line that a ship
 * flies over without noticing becomes, from a vehicle, a series of walls and
 * ramps, and the day's actual volatility decides where they are. A calm day
 * drives straight through; a violent one has to be worked around on foot.
 */
const MAX_CLIMB = 0.9;
/** How far ahead it checks the ground. One car length. */
const PROBE = 26;

export function updateConvoy(state: RunState, dt: number, drive: number): void {
  const convoy = state.convoy;
  if (!convoy || convoy.arrived || convoy.health <= 0) return;
  if (state.finished) return;

  convoy.stalled = !state.driving || drive === 0;
  if (convoy.stalled) {
    convoy.blocked = false;
    return;
  }

  const direction = Math.sign(drive);
  const speed = convoySpeed(state.extractionX, state.seconds) * Math.abs(drive);
  const next = convoy.x + direction * speed * dt;

  /*
   * Refuse a climb that is too steep, rather than crawling up it slowly.
   *
   * A vehicle that grinds up anything eventually makes the terrain decorative
   * again. A hard stop makes a ridge a real decision: get out and clear a way
   * round, or back up and take the run at it from somewhere flatter.
   */
  const here = state.terrain.groundAt(convoy.x);
  const ahead = state.terrain.groundAt(convoy.x + direction * PROBE);
  const rise = here - ahead;

  if (rise > MAX_CLIMB * PROBE) {
    convoy.blocked = true;
    return;
  }
  convoy.blocked = false;

  convoy.x = Math.max(0, Math.min(state.extractionX, next));
  convoy.y = state.terrain.groundAt(convoy.x) - CONVOY_RADIUS;

  if (convoy.x >= state.extractionX) {
    convoy.arrived = true;
    state.emit({ kind: 'extracted', x: convoy.x, y: convoy.y, text: 'Cargo through' });
  }
}

export function damageConvoy(state: RunState, amount: number): void {
  const convoy = state.convoy;
  if (!convoy || convoy.arrived || convoy.health <= 0) return;

  convoy.health = Math.max(0, convoy.health - amount);
  state.emit({ kind: 'hit', x: convoy.x, y: convoy.y });

  if (convoy.health <= 0) {
    /*
     * Lost, and the run ends there.
     *
     * Not "the player limps on with nothing to deliver": a mission whose
     * objective is already gone but which keeps running for another forty
     * seconds is a punishment with no decision left in it.
     */
    /*
     * Clear the wheel here rather than letting the driving code notice.
     *
     * Setting the phase ends the run, and step() returns early once a run is
     * over, so updatePlayer never runs again and the flag would stay set
     * forever. State that outlives the thing it describes is how a later
     * screen ends up reading DRIVING with no vehicle in existence.
     */
    state.driving = false;
    state.emit({ kind: 'lost', x: convoy.x, y: convoy.y, text: 'CARGO LOST' });
    state.phase = 'died';
  }
}
