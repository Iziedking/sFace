/**
 * The faces, and the five quirks that make rescuing them a decision.
 *
 * A rescue target that just follows you is a pickup. A rescue target that
 * argues with you is a mechanic. Each quirk taxes a different habit:
 *
 *   heavy      Costs thrust while carried. Handled in player.ts.
 *   talker     Stops mid-flight to finish a sentence. You wait or you leave.
 *   paranoid   Will not be freed while anything is shooting nearby.
 *   skittish   Only follows while you have held fire. Rescue or return fire.
 *   mercenary  Lets himself out partway and keeps a cut of his own bounty.
 *
 * The joke is the wrapping. The quirk is the design.
 */

import { circlesOverlap, clamp } from './collision';
import { threatNear } from './enemy';
import type { Face, RunState } from './state';
import { RESCUE_FRACTION } from './state';
import { CEILING, EXTRACTION_X } from './terrain';

export const FACE_RADIUS = 15;

/** How close you must get to free one. Generous, because thumbs are imprecise. */
const RESCUE_REACH = 46;

/** Trail index for the first follower, then this far back for each one after. */
const FIRST_SLOT_DELAY = 14;
const SLOT_GAP = 12;

/** How hard a follower is pulled toward its spot in the chain. */
const FOLLOW_SPRING = 9;

const PARANOID_CLEAR_RANGE = 280;
const SKITTISH_CEASEFIRE = 2;
const TALKER_INTERVAL = 6.5;
const TALKER_PAUSE = 1.3;

/** The Last Market Maker's cut of his own extraction. He is not shy about it. */
const MERCENARY_FEE = 0.4;

export function updateFaces(state: RunState, dt: number): void {
  for (const face of state.faces) {
    switch (face.state) {
      case 'trapped':
        tryFree(state, face);
        break;
      case 'following':
        follow(state, face, dt);
        break;
      default:
        break;
    }
  }
}

function tryFree(state: RunState, face: Face): void {
  const player = state.player;
  const touching = circlesOverlap(
    { x: player.x, y: player.y, r: RESCUE_REACH },
    { x: face.x, y: face.y, r: FACE_RADIUS },
  );
  if (!touching) return;

  // Madam Cold Storage does not trust the route. Clear it first.
  if (face.quirk === 'paranoid' && threatNear(state, face.x, face.y, PARANOID_CLEAR_RANGE)) {
    return;
  }

  face.state = 'following';
  face.slot = nextSlot(state);
  face.freedAt = state.time;
  face.pausedUntil = 0;
  face.nextTalkAt = state.time + TALKER_INTERVAL;

  state.facesFreed++;
  // Credit lands the moment you free one, so progress always registers even on
  // a run that ends badly. The rest is only paid at extraction.
  state.rescueScore += face.bounty * RESCUE_FRACTION;

  state.emit({ kind: 'freed', x: face.x, y: face.y });
  state.emit({ kind: 'pickupLine', text: face.line, x: face.x, y: face.y });
}

function follow(state: RunState, face: Face, dt: number): void {
  // The Last Market Maker can get himself out. His fee is separate.
  if (face.quirk === 'mercenary' && face.x >= face.selfExtractX) {
    face.state = 'extracted';
    state.facesExtracted++;
    state.extractionScore += face.bounty * (1 - RESCUE_FRACTION) * (1 - MERCENARY_FEE);
    state.emit({ kind: 'extracted', text: 'Took his fee and left', x: face.x, y: face.y });
    return;
  }

  if (holdingPosition(state, face)) return;

  const target = trailTarget(state, face);
  // A spring rather than a hard snap, so the chain has some drag to it and
  // reads as five people being towed rather than five stickers on the ship.
  const pull = 1 - Math.exp(-FOLLOW_SPRING * dt);
  face.x += (target.x - face.x) * pull;
  face.y += (target.y - face.y) * pull;

  // Never let a follower render inside a hill.
  const ground = state.terrain.groundAt(face.x) - FACE_RADIUS;
  face.y = clamp(face.y, CEILING + FACE_RADIUS, ground);
}

/** Quirks that make a follower stop moving for a while. */
function holdingPosition(state: RunState, face: Face): boolean {
  if (face.quirk === 'talker') {
    if (state.time < face.pausedUntil) return true;
    // Scheduled explicitly rather than tested with a modulo. At a 60Hz step a
    // modulo window either misses the tick or catches it twice depending on
    // float drift, and the bug reads as a face that randomly ignores its quirk.
    if (state.time >= face.nextTalkAt) {
      face.pausedUntil = state.time + TALKER_PAUSE;
      face.nextTalkAt = state.time + TALKER_PAUSE + TALKER_INTERVAL;
      state.emit({ kind: 'pickupLine', text: 'One more thing.', x: face.x, y: face.y });
      return true;
    }
    return false;
  }

  if (face.quirk === 'skittish') {
    // The Whitepaper Prophet does not follow anyone who is shooting.
    return state.time - state.player.lastFiredAt < SKITTISH_CEASEFIRE;
  }

  return false;
}

function trailTarget(state: RunState, face: Face): { x: number; y: number } {
  const index = FIRST_SLOT_DELAY + face.slot * SLOT_GAP;
  const point = state.trail[Math.min(index, state.trail.length - 1)];
  return point ?? { x: state.player.x, y: state.player.y };
}

function nextSlot(state: RunState): number {
  return state.faces.filter((f) => f.state === 'following').length;
}

/**
 * Everyone still following is out. Called once when the ship touches the pad.
 * Faces already banked by the mercenary path are untouched.
 */
export function extractFollowers(state: RunState): void {
  for (const face of state.faces) {
    if (face.state !== 'following') continue;
    face.state = 'extracted';
    state.facesExtracted++;
    state.extractionScore += face.bounty * (1 - RESCUE_FRACTION);
    state.emit({ kind: 'extracted', text: face.name, x: face.x, y: face.y });
  }
}

/** The ship went down. Anyone aboard went down with it. */
export function loseFollowers(state: RunState): void {
  for (const face of state.faces) {
    if (face.state !== 'following') continue;
    face.state = 'lost';
    state.emit({ kind: 'lost', text: face.name, x: face.x, y: face.y });
  }
}

export function atExtraction(state: RunState): boolean {
  return state.player.x >= EXTRACTION_X;
}
