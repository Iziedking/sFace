/**
 * Being seen.
 *
 * Stages one to three are a shooting problem: everything that can hurt you is
 * visible, and the answer is always aim better. That is the right first hour of
 * this game and the wrong seventh, because a harder version of one verb is not
 * a different stage, it is the same stage with bigger numbers. Flying all seven
 * felt identical for exactly that reason.
 *
 * From stage four the level is watching. Turrets hold a fixed arc, drifters
 * sweep one. Fly through an arc with nothing between you and the watcher and
 * the alert climbs; break the line and it falls. Fill it and the stretch ahead
 * wakes up early and starts shooting faster.
 *
 * That turns the question from "can I hit that" into "can I get past that
 * without being read", which is a genuinely different skill using entirely
 * existing pieces. No new entity, no new enemy, no new art.
 *
 * ## Determinism
 *
 * Everything here is a pure function of positions, terrain and the run clock.
 * No random draw, at construction or during play. Two players on one seed who
 * fly the same path get the same alert at the same moment, so a challenge
 * settled on a stealth stage is as fair as one settled on stage one. That is
 * not a nice property, it is the condition for this being allowed to exist:
 * anything that changes the score has to be reproducible.
 *
 * ## Why the alert is a meter and not a flag
 *
 * A flag makes being seen binary, and binary stealth punishes a single frame of
 * bad luck as hard as a careless approach. A meter that fills and drains lets a
 * player cross a corner of an arc and get away with it, which is the moment
 * that makes stealth feel good rather than fussy.
 */

import type { Enemy, RunState } from './state';
import type { Terrain } from './terrain';

/** How wide a watcher's arc is, half-angle in radians. About 50 degrees. */
const CONE_HALF = 0.44;
/** How far it reaches. Short enough to leave routes, long enough to matter. */
export const SIGHT_RANGE = 520;

/** Seconds of unbroken sight to go from calm to fully alerted. */
const FILL_SECONDS = 1.15;
/** Seconds of no sight to come all the way back down. Slower than filling. */
const DRAIN_SECONDS = 2.6;

/**
 * Once full, the level stays angry this long even if you break the line.
 *
 * Cut from six. Six seconds of a faster level, landing on a stage that had also
 * just lost a third of its refills, made stage four unfinishable rather than
 * tense. Being caught should cost a stretch of the run, not the run.
 */
export const ALERTED_SECONDS = 4.5;

/** How far ahead a full alert wakes the level. */
const WAKE_AHEAD = 1400;
/**
 * Alerted attackers reload this much faster.
 *
 * Raised from 0.62, which was a sixty per cent faster reload and far too steep.
 * The punishment for being seen should be that the level gets ahead of you, not
 * that the hull disappears while you watch. Twenty-five per cent is felt
 * without being fatal, and the real cost of an alert is the woken stretch
 * ahead rather than the rate.
 */
export const ALERT_FIRE_SCALE = 0.8;

/** Only these two watch. Divers and runners are already committed to you. */
export function watches(enemy: Enemy): boolean {
  return enemy.kind === 'turret' || enemy.kind === 'drifter';
}

/**
 * Where a watcher is looking, in radians.
 *
 * A turret holds the arc it was built with. A drifter sweeps, driven by the run
 * clock and its own phase so the whole field never sweeps in unison, which
 * would produce a single safe beat everybody learns and nothing else.
 *
 * Both are pure functions of state the level already carries.
 */
export function gaze(enemy: Enemy, time: number): number {
  if (enemy.kind === 'turret') {
    // Turrets were placed on the ground, so they look up and out. The phase
    // they already carry for animation doubles as which way they face.
    return -Math.PI / 2 + Math.sin(enemy.phase) * 0.8;
  }
  return Math.sin(time * 0.55 + enemy.phase) * Math.PI;
}

/** Smallest angle between two headings, always positive. */
function angleBetween(a: number, b: number): number {
  let d = Math.abs(a - b) % (Math.PI * 2);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return d;
}

/**
 * Is the ground in the way?
 *
 * Sampled rather than solved, because the terrain is a polyline sampled at a
 * fixed spacing and there is no closed form worth deriving for it. Sixteen
 * steps is enough to catch a hill between two points at this range and cheap
 * enough to run for every watcher every frame.
 *
 * Sampling starts past the watcher and stops before the target, so a turret
 * sitting ON the ground is not blocked by the ground it is standing on.
 */
export function blocked(terrain: Terrain, from: Enemy, toX: number, toY: number): boolean {
  const steps = 16;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = from.x + (toX - from.x) * t;
    const y = from.y + (toY - from.y) * t;
    if (y > terrain.groundAt(x)) return true;
  }
  return false;
}

/** True when this watcher can currently see that point. */
export function sees(
  enemy: Enemy,
  terrain: Terrain,
  time: number,
  x: number,
  y: number,
): boolean {
  if (!enemy.alive || !watches(enemy)) return false;

  const dx = x - enemy.x;
  const dy = y - enemy.y;
  const distance = Math.hypot(dx, dy);
  if (distance > SIGHT_RANGE) return false;

  if (angleBetween(Math.atan2(dy, dx), gaze(enemy, time)) > CONE_HALF) return false;

  return !blocked(terrain, enemy, x, y);
}

/**
 * Advance the alert for this frame.
 *
 * Called from the run step. Fills while any watcher has the player, drains
 * otherwise, and latches at the top so filling it once has a consequence that
 * outlives the moment rather than evaporating as soon as you duck.
 */
export function updateSight(state: RunState, dt: number): void {
  if (!state.stage.sight) return;
  if (state.finished) return;

  const player = state.player;

  let watched = false;
  for (const enemy of state.enemies) {
    // Asleep watchers are not watching. Otherwise the whole level would see you
    // from the first frame and the meter would be full before you moved.
    if (!enemy.active) continue;
    if (sees(enemy, state.terrain, state.time, player.x, player.y)) {
      watched = true;
      break;
    }
  }

  state.watched = watched;

  if (state.time < state.alertedUntil) {
    // Already caught. Hold the meter up so it does not visibly drain while the
    // consequence is still running, which would read as the game forgetting.
    state.alert = 1;
    return;
  }

  const rate = watched ? dt / FILL_SECONDS : -dt / DRAIN_SECONDS;
  state.alert = Math.min(1, Math.max(0, state.alert + rate));

  if (state.alert >= 1) raise(state);
}

/**
 * Caught.
 *
 * The consequence is deliberately built from things the level already has
 * rather than from anything new. Nothing spawns: spawning under alert would
 * mean the number of attackers depends on how well you played, and two players
 * on one seed would face different levels. Instead the stretch ahead simply
 * stops being asleep, and everyone shoots faster while it lasts.
 */
function raise(state: RunState): void {
  state.alertedUntil = state.time + ALERTED_SECONDS;
  state.alertsRaised++;

  for (const enemy of state.enemies) {
    if (!enemy.alive || enemy.active) continue;
    if (enemy.x > state.player.x && enemy.x < state.player.x + WAKE_AHEAD) {
      enemy.active = true;
    }
  }

  state.emit({ kind: 'lost', x: state.player.x, y: state.player.y, text: 'SEEN' });
}

/** True while the consequence is running. Read by the enemy fire rate. */
export function alerted(state: RunState): boolean {
  return state.time < state.alertedUntil;
}
