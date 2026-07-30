/**
 * Aim assist: help pointing the gun, on a phone and on a desktop.
 *
 * ## The problem it solves
 *
 * Aiming is the hardest thing this game asks of a thumb. The left thumb steers
 * in two axes, the right one has to hold a fire button AND push a direction, and
 * the target is a figure the size of a fingernail that is moving. On a desktop a
 * mouse makes it trivial; on a phone it is the difference between the game
 * feeling good and feeling broken, and a phone is where Nimiq Pay lives.
 *
 * So the gun bends toward what you are nearly pointing at. Nearly is the whole
 * design: assist NARROWS the gap between where you aimed and where a target is,
 * it never picks a target for you, and it cannot turn the gun to something you
 * were not already facing.
 *
 * ## Why there is a baseline everybody gets
 *
 * The obvious build is to make assist the reward and leave everyone else with
 * the raw stick. That gets the incentive right and the game wrong: a new player
 * on a phone would meet the version of sFace that is least playable, decide
 * shooting does not work, and never reach the thing they were meant to be
 * earning. So the baseline is free and universal, and progression buys MORE.
 *
 * ## Why a staked run is pinned to the baseline
 *
 * Two people betting NIM on one seed have to be playing the same game. The
 * camera already refuses to show a desktop more of the world than a phone for
 * exactly this reason. Aim assist is a bigger advantage than viewport, so a
 * challenge clamps both sides to the baseline: the bet is settled on who played
 * better today, not on who has been playing longer.
 *
 * The campaign and the daily board deliberately do NOT clamp. Everything there
 * is earned by playing, everyone can earn it, and gating a solo score behind
 * somebody else's progress would make the ladder unclimbable.
 *
 * ## Determinism
 *
 * A pure function of the aim, the target list and the level. No random draws, no
 * clock. Two players who move identically with the same level get identical aim,
 * so a recorded run still replays and a challenge still settles.
 */

import { lineBlocked } from './city';
import type { RunState } from './state';

export type AssistLevel = 0 | 1 | 2 | 3;

interface Tier {
  /** Half-angle of the cone the gun will bend inside, radians. */
  cone: number;
  /** How much of the remaining gap is closed. 1 would be a hard lock. */
  pull: number;
  /** How far out it looks for something to help with. */
  range: number;
  /** Shown on the loadout screen. */
  label: string;
}

/**
 * Never a hard lock, at any tier.
 *
 * Even the top tier tops out at closing most of the gap rather than all of it,
 * because a gun that snaps exactly onto a target removes the act of aiming and
 * with it any reason to feel good about a hit. The ceiling is what keeps this an
 * assist rather than an auto-shooter.
 */
const TIERS: Record<AssistLevel, Tier> = {
  0: { cone: 0, pull: 0, range: 0, label: 'Off' },
  // Free, and tuned for a thumb rather than a mouse: wide enough that a roughly
  // correct push connects, weak enough that where you pointed still decides.
  1: { cone: 0.16, pull: 0.4, range: 560, label: 'Steady' },
  2: { cone: 0.24, pull: 0.62, range: 700, label: 'Tracking' },
  3: { cone: 0.34, pull: 0.8, range: 840, label: 'Lock' },
};

/** What every player gets, on every device, from their first run. */
export const BASELINE_ASSIST: AssistLevel = 1;

export function assistTier(level: AssistLevel): Tier {
  return TIERS[level];
}

/**
 * What this player has earned.
 *
 * Reads progression that already exists rather than inventing a currency for it.
 * Clearing stages is the campaign's own measure of getting better, so the thing
 * that makes shooting easier is unlocked by the thing that proves you can
 * already shoot.
 *
 * `staked` pins to the baseline, and it is a parameter rather than something
 * read from a global so that the fairness rule is visible at the call site
 * instead of buried in here.
 */
export function earnedAssist(
  progress: { stagesCleared: number; clanWins?: number; challengeWins?: number },
  staked: boolean,
): AssistLevel {
  if (staked) return BASELINE_ASSIST;

  const clan = progress.clanWins ?? 0;
  const challenges = progress.challengeWins ?? 0;

  /*
   * Three routes to the same unlock, because the three things the game asks of
   * you are different skills and any of them should count. Grinding the campaign
   * solo, carrying a clan, or beating people head to head all arrive at the same
   * place, and nobody is locked out because they have nobody to play against.
   */
  if (progress.stagesCleared >= 5 || clan >= 3 || challenges >= 5) return 3;
  if (progress.stagesCleared >= 3 || clan >= 1 || challenges >= 2) return 2;
  return BASELINE_ASSIST;
}

/**
 * Bend an aim direction toward the nearest thing worth shooting.
 *
 * Takes and returns a unit vector. Called from the one place the gun's direction
 * is decided, so nothing else in the game needs to know assist exists.
 */
export function steerAim(
  state: RunState,
  aimX: number,
  aimY: number,
): { x: number; y: number } {
  const tier = TIERS[state.assist];
  if (tier.pull <= 0) return { x: aimX, y: aimY };

  const player = state.player;
  const city = state.city;

  let bestX = 0;
  let bestY = 0;
  let bestOff = tier.cone;
  let found = false;

  for (const enemy of state.enemies) {
    if (!enemy.alive) continue;

    const dx = enemy.x - player.x;
    const dy = enemy.y - player.y;
    const distance = Math.hypot(dx, dy);
    if (distance > tier.range || distance < 1) continue;

    const ux = dx / distance;
    const uy = dy / distance;

    /*
     * Angle between where the player pointed and where the target is, via the
     * dot product rather than two atan2 calls and a wrap. Cheaper, and it cannot
     * get the sign wrong near the half turn, which an angle difference can.
     */
    const dot = Math.max(-1, Math.min(1, aimX * ux + aimY * uy));
    const off = Math.acos(dot);
    if (off >= bestOff) continue;

    /*
     * Never help you shoot through a wall.
     *
     * Without this the city's whole point collapses: cover would stop bullets
     * while the gun cheerfully tracked the man behind it, which is worse than no
     * assist because it tells the player they have a shot they do not have.
     */
    if (city && lineBlocked(city, player.x, player.y, enemy.x, enemy.y)) continue;

    bestOff = off;
    bestX = ux;
    bestY = uy;
    found = true;
  }

  if (!found) return { x: aimX, y: aimY };

  /*
   * Ease off as the target approaches the edge of the cone.
   *
   * A flat pull across the whole cone makes the gun grab as a target crosses the
   * boundary, which feels like the aim being taken away. Scaling the pull by how
   * centred the target already is means help arrives smoothly and is strongest
   * exactly where the player was clearly trying to shoot.
   */
  const centred = 1 - bestOff / tier.cone;
  const strength = tier.pull * centred;

  const x = aimX + (bestX - aimX) * strength;
  const y = aimY + (bestY - aimY) * strength;
  const length = Math.hypot(x, y);
  if (length < 1e-6) return { x: aimX, y: aimY };

  return { x: x / length, y: y / length };
}
