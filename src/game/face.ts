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
import { CEILING } from './terrain';
import { isCaged } from './cell';
import { spawnBullet } from './bullet';

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
  // Locked up. The door has to come off first, and only a breaching charge
  // takes it off. Checked before the reach test so no amount of nudging the
  // bars ever reads as almost working.
  if (isCaged(face)) return;

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

/**
 * Freed people shoot back.
 *
 * ## Why this is a rescue mechanic and not a combat one
 *
 * Before this, a rescued person was a number you were carrying. They slowed you
 * down if heavy, they were lost if you died, and they paid out at the pad. Every
 * one of those is a COST, so the optimal line was always "free them last, on the
 * way to extraction", and the game quietly taught players to ignore the thing it
 * is named after until the final seconds.
 *
 * Giving them a gun inverts that. Freeing somebody early now buys you covering
 * fire for the rest of the run, so the decision becomes a real trade: carry them
 * through the dangerous middle and they help, or play safe and go alone. That is
 * the same shape as every other choice in this game, and it makes the title
 * describe the strategy rather than just the theme.
 *
 * ## Why they are deliberately bad at it
 *
 * They are civilians with something they found. A quarter of the damage and a
 * slow cadence means four or five hits to drop a diver where the player takes
 * one or two. They thin a crowd and finish something wounded; they do not clear
 * a level. If a full chain could out-shoot the player, the optimal play would
 * become "collect everyone, then stop flying", which is a worse game than the
 * one this is trying to be.
 *
 * ## Determinism
 *
 * Cadence is drawn from the run stream, in face array order, exactly like enemy
 * fire. Two players who fly the same path free the same people at the same
 * moments and get the same covering fire, so a challenge stays settleable.
 */

/** Damage per escort shot. A quarter of what a sidearm round does. */
const ESCORT_DAMAGE = 5;
/** How far they will engage. Shorter than the player's reach, on purpose. */
const ESCORT_RANGE = 340;
const ESCORT_BULLET_SPEED = 520;

function escortFire(state: RunState, face: Face, dt: number): void {
  face.fireCooldown -= dt;
  if (face.fireCooldown > 0) return;

  // Nearest live, woken attacker in range. Asleep ones are left alone so a
  // chain does not wake the level early on the player's behalf.
  let target = null as null | { x: number; y: number };
  let best = ESCORT_RANGE;
  for (const enemy of state.enemies) {
    if (!enemy.alive || !enemy.active) continue;
    const distance = Math.hypot(enemy.x - face.x, enemy.y - face.y);
    if (distance < best) {
      best = distance;
      target = enemy;
    }
  }

  if (!target) return;

  const dx = target.x - face.x;
  const dy = target.y - face.y;
  const length = Math.hypot(dx, dy) || 1;

  spawnBullet(state, {
    x: face.x + (dx / length) * 16,
    y: face.y + (dy / length) * 16,
    vx: (dx / length) * ESCORT_BULLET_SPEED,
    vy: (dy / length) * ESCORT_BULLET_SPEED,
    life: 1.1,
    damage: ESCORT_DAMAGE,
    friendly: true,
    pierce: 0,
  });

  // Ragged on purpose. A chain firing in lockstep sounds and looks like one
  // weapon, which is not what four frightened people with pistols would be.
  face.fireCooldown = state.runRng.range(0.85, 1.45);
}

function follow(state: RunState, face: Face, dt: number): void {
  escortFire(state, face, dt);

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
  return state.player.x >= state.extractionX;
}
