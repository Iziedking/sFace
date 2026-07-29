/**
 * Cells: the rescue that is not a firefight.
 *
 * Every rescue in this game used to be the same verb. Fly to a person, touch
 * them, tow them home. The shooting was between you and the person, so the
 * answer to every level was "shoot better", and a game whose only problem is
 * aim runs out of problems fast.
 *
 * A cell breaks that. Someone taking the worst of the day is locked up, and
 * touching them does nothing at all. You need a breaching charge, which costs
 * the scrip you were going to spend on a bomb or a hull patch, and the charge
 * has to be spent standing next to the cell rather than from safety. So the
 * question stops being "can I hit that" and becomes "can I afford to get in,
 * and can I hold the ground long enough to use it".
 *
 * ## Why a cell is a property of the face, not a separate entity
 *
 * A cell is only ever a state a trapped person is in. Modelling it as its own
 * entity would mean two lists that have to agree about who is inside what, and
 * the first time they disagreed there would be a person locked in a cell that
 * no longer exists. A flag on the face cannot desynchronise from the face.
 *
 * ## Determinism
 *
 * Which faces start caged is drawn once from the LEVEL stream at construction,
 * like everything else two players must share. Nothing about a cell is decided
 * during play.
 */

import type { Rng } from '../core/rng';
import { circlesOverlap } from './collision';
import type { Face, RunState } from './state';

/** How close you must be to set a charge. Deliberately inside the danger. */
export const BREACH_REACH = 96;

/** Drawn as a box around the person. Also the radius the charge must reach. */
export const CELL_RADIUS = 42;

/**
 * How many of the day's five are locked up, by stage.
 *
 * Stage one has none: the first thing a new player meets should be the simple
 * version of the verb. It climbs to most of the roster by the last stage,
 * which is what makes the late campaign feel like a break-in rather than a
 * longer shoot.
 */
export function cagedCount(stage: number, roster: number): number {
  if (stage <= 1) return 0;
  const share = Math.min(0.6, (stage - 1) * 0.12);
  return Math.min(roster - 1, Math.round(roster * share));
}

/**
 * Lock up a seeded subset. Called once, during level construction.
 *
 * At least one face is always left free, so a run can never open with every
 * rescue behind a paywall of scrip the player has not earned yet.
 */
export function lockUp(rng: Rng, faces: Face[], stage: number): void {
  const count = cagedCount(stage, faces.length);
  if (count <= 0) return;

  // Shuffle a copy of the indices rather than picking at random with retries,
  // so the number of draws taken from the level stream is fixed regardless of
  // how the shuffle lands. A variable number of draws would shift every later
  // draw and change the rest of the level.
  const order = faces.map((_, index) => index);
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const a = order[i]!;
    const b = order[j]!;
    order[i] = b;
    order[j] = a;
  }

  for (let i = 0; i < count; i++) {
    const face = faces[order[i]!];
    if (face) face.caged = true;
  }
}

/** True when this person cannot be freed by touch alone. */
export function isCaged(face: Face): boolean {
  return face.caged && face.state === 'trapped';
}

/** The nearest cell a charge set from here would open, or null. */
export function cellInReach(state: RunState): Face | null {
  const player = state.player;

  let best: Face | null = null;
  let bestDistance = Infinity;

  for (const face of state.faces) {
    if (!isCaged(face)) continue;
    const near = circlesOverlap(
      { x: player.x, y: player.y, r: BREACH_REACH },
      { x: face.x, y: face.y, r: CELL_RADIUS },
    );
    if (!near) continue;

    const distance = Math.hypot(face.x - player.x, face.y - player.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = face;
    }
  }

  return best;
}

/**
 * Open one cell. Returns the face that was let out, or null if none was near.
 *
 * Opening does not rescue: the door comes off and the person is then trapped in
 * the ordinary way, to be picked up by touch like anyone else. Two steps, so a
 * charge is a way in rather than a remote rescue button.
 */
export function breach(state: RunState): Face | null {
  const face = cellInReach(state);
  if (!face) return null;

  face.caged = false;
  state.cellsOpened++;
  state.emit({ kind: 'freed', x: face.x, y: face.y, text: 'Door off' });

  return face;
}
