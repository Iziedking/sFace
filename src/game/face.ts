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
import { FACE_MAX_HEALTH, RESCUE_FRACTION } from './state';
import { CEILING } from './terrain';
import { isCaged } from './cell';
import { spawnBullet } from './bullet';

export const FACE_RADIUS = 15;

/*
 * What somebody you are carrying can take
 * ======================================
 *
 * ## Why they can be hurt at all
 *
 * They could not be, and that quietly undercut the whole game. Freeing people
 * was a thing you did to a level rather than a thing you then had to protect,
 * so once somebody was in the chain they were banked and the rest of the run
 * was about your own hull. A game named after saving people should be able to
 * lose one.
 *
 * ## Why they are hard to kill, and how
 *
 * Three separate things make this survivable, and all three are needed.
 *
 * They take a share of a round rather than all of it, so a hit costs less than
 * it costs you. They have more to spend than the arithmetic suggests: at these
 * numbers it is roughly sixteen hits, against the thirteen it takes to put the
 * player down. And it comes back. Damage that stops recovers in a couple of
 * seconds, so a stray round in a crossfire never costs a rescue.
 *
 * The last one is what makes the word "sustained" mean something. Killing
 * somebody in the chain requires holding fire on them without a break, which is
 * a thing the player can see happening and fly out of. Losing one should feel
 * like a mistake you made, never like a dice roll you lost.
 *
 * ## Only while following
 *
 * Somebody trapped or in a cell cannot be touched. A person dying before you
 * reached them is a run lost to something nobody could prevent, and on a stage
 * that counts extractions to pass it could make the level unwinnable before it
 * started.
 */

/*
 * Their hull is declared in state.ts, beside the player's, because Face is
 * declared there and the two files would otherwise import each other for one
 * number. Re-exported so callers can reach it from the mechanic it belongs to.
 */
export { FACE_MAX_HEALTH };

/**
 * The share of a round that lands on somebody being carried.
 *
 * They are smaller than the ship and they are not the thing being aimed at, so
 * most of what reaches them is a graze. This is the difference between a chain
 * that dies in a firefight and one that has to be deliberately shot apart.
 */
export const FACE_DAMAGE_SHARE = 0.6;

/** Quiet seconds before the recovery starts. */
const RECOVERY_DELAY = 2.2;
/** Hull per second once it does. Full again about three seconds after that. */
const RECOVERY_RATE = 30;

/**
 * Hurt somebody in the chain. Returns true if that was the hit that ended them.
 *
 * A death fails the run rather than merely costing the bounty. That is the
 * point of the mechanic: the people are the objective, so losing one is losing.
 */
export function damageFace(state: RunState, face: Face, amount: number): boolean {
  if (face.state !== 'following') return false;

  face.health = Math.max(0, face.health - amount * FACE_DAMAGE_SHARE);
  face.hurtAt = state.time;
  state.emit({ kind: 'hit', x: face.x, y: face.y });

  if (face.health > 0) return false;

  face.state = 'lost';
  state.emit({ kind: 'lost', x: face.x, y: face.y, text: `${face.name} DOWN` });
  state.phase = 'died';
  return true;
}

/** Whether to draw a hull over somebody: only when it is not full. */
export function faceHurt(face: Face): boolean {
  return face.state === 'following' && face.health < FACE_MAX_HEALTH;
}

/** Give back what was taken, once the shooting has stopped. */
function recover(state: RunState, face: Face, dt: number): void {
  if (face.health >= FACE_MAX_HEALTH) return;
  if (state.time - face.hurtAt < RECOVERY_DELAY) return;

  face.health = Math.min(FACE_MAX_HEALTH, face.health + RECOVERY_RATE * dt);
}


/** How close you must get to free one. Generous, because thumbs are imprecise. */
const RESCUE_REACH = 46;

/*
 * Where each follower sits in the chain, counted in trail points.
 *
 * The trail records a point every TRAIL_STEP world units, so these are
 * distances rather than delays: the first person flies about two ship lengths
 * back and each one after that is another two behind them. Far enough apart to
 * read as a line of people being led out, close enough that the tail is not
 * still in the last room.
 */
const FIRST_SLOT_BACK = 2;
const SLOT_GAP = 2;

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

/*
 * What a rescued person is worth in a fight.
 *
 * Still clearly worse than the player: about a third of a sidearm round, a
 * slower cadence, and a shorter reach. What changed is that it is now enough to
 * notice. At a quarter damage and a round a second and a half, a full chain
 * barely moved a health bar, so the covering fire the design is built around
 * was invisible in play and read as decoration.
 *
 * They thin a crowd and finish something wounded. They still do not clear a
 * level, because a chain that out-shoots the player would make the best line
 * "collect everyone, then stop flying".
 */
const ESCORT_DAMAGE = 7;
/** How far they will engage. Shorter than the player's reach, on purpose. */
const ESCORT_RANGE = 380;
const ESCORT_BULLET_SPEED = 560;

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
    // Drawn in the rescue colour, so you can see your people working.
    fromEscort: true,
    pierce: 0,
  });

  // Ragged on purpose. A chain firing in lockstep sounds and looks like one
  // weapon, which is not what four frightened people with pistols would be.
  face.fireCooldown = state.runRng.range(0.7, 1.15);
}

function follow(state: RunState, face: Face, dt: number): void {
  recover(state, face, dt);
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

  /*
   * Never let a follower render inside a hill, on a stage that has hills.
   *
   * A city and the ring city have no ground line, and `groundAt` still answers
   * with one: a y somewhere in the old chart's band, which is near the top of a
   * ring world 5,800 tall. Clamping to it dragged the whole chain up there and
   * left it behind while the player worked inward, so the people you had just
   * freed were not with you and could not shoot for you.
   *
   * Nothing to clamp against in those worlds. The spring above already keeps
   * followers on the trail the player actually flew, which never goes through
   * a wall.
   */
  if (!state.freeWorld) {
    const ground = state.terrain.groundAt(face.x) - FACE_RADIUS;
    face.y = clamp(face.y, CEILING + FACE_RADIUS, ground);
  }
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
  const index = FIRST_SLOT_BACK + face.slot * SLOT_GAP;
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
  /*
   * In a city the way out is a place, not an edge.
   *
   * On a chart run "past this x" is the whole test, because the world is a
   * corridor and there is only one direction that counts as leaving. A city has
   * no far end: you can be at the same x as the exit and six streets north of
   * it. So it is a radius around a point, and reaching it is something you have
   * to navigate to rather than something that happens when you run out of map.
   */
  const city = state.city;
  if (city) {
    return Math.hypot(state.player.x - city.exitX, state.player.y - city.exitY) <= CITY_EXIT_REACH;
  }

  return state.player.x >= state.extractionX;
}

/** Matches the ring the renderer draws, so the marker is the trigger. */
const CITY_EXIT_REACH = 70;
