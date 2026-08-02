/**
 * The attackers. Four kinds, and each one asks a different question.
 *
 *   drifter  Hovers and shoots aimed single rounds. Punishes standing still.
 *   diver    Ignores its gun and flies at you. Punishes hovering in the open.
 *   turret   Bolted to the chart, throws a spread upward. Punishes flying low.
 *   runner   Drives the chart at you and fires flat along it. Punishes
 *            travelling at ground level, which nothing else did.
 *
 * Between them you cannot solve the level with one habit, which is the whole
 * design goal. The runner earned its place by asking for a response none of the
 * other three do: climb. Anything that wants the same answer as an existing
 * attacker is a reskin and does not belong here.
 *
 * Placement is decided once at level construction from the seed. This file only
 * wakes them and runs their behaviour, and it draws from runRng, never from the
 * level stream, so two players on the same seed keep the same level.
 */

import { direction, withinRange } from './collision';
import { spawnBullet, ENEMY_BULLET_DAMAGE, ENEMY_BULLET_SPEED } from './bullet';
import type { Enemy, RunState } from './state';
import { ATTACKER_SCORE } from './state';
import type { RunState as Run } from './state';
import { CEILING, WORLD_HEIGHT } from './terrain';
import { earn } from './scrip';
import { ALERT_FIRE_SCALE, alerted } from './sight';
import { updatePatrol } from './patrol';

export const ENEMY_RADIUS = 16;
export const TURRET_RADIUS = 19;
export const DIVER_CONTACT_DAMAGE = 14;

/**
 * How far ahead of the player an enemy wakes up. Roughly one screen.
 *
 * Must stay comfortably LARGER than SIGHT_RANGE. A watcher only draws its cone
 * once awake, so if it could see further than it wakes, the first thing a
 * player would know about it is the alert going off, spotted by something that
 * was not on screen. Stealth you cannot see coming is not stealth, it is a
 * dice roll. Pinned by a test in tests/sight.test.ts.
 */
export const ACTIVATION_RANGE = 780;
/** Past this far behind, stop spending cycles on it. */
const ABANDON_RANGE = 900;

/**
 * How many shots a turret puts out at once, over the length of a run.
 *
 * It opens at one, the same as the player, and climbs to three by the end. A
 * three-shot fan from the first second is what made the early game read as
 * chaos: you have not learned the ship yet and there is already more in the
 * air than you can parse.
 *
 * Driven by the **run clock, not the score**, and that distinction matters.
 * Scaling on score would mean two players on the same seed face different
 * levels, and the whole challenge system rests on them facing the same one.
 * It would also punish playing well, which is a strange thing for a game to
 * do. Time rises with score anyway, so it delivers the same escalation
 * without breaking the bet.
 */
function volleyAt(state: Run): number {
  const seconds = state.time;
  const [opening, closing] = state.stage.volley;
  // A stage that opens and closes on the same number never ramps, which is how
  // Stage 1 stays a soft entry and Stage 7 is three from the first second.
  if (opening === closing) return opening;
  if (seconds < state.seconds / 3) return opening;
  if (seconds < (state.seconds * 2) / 3) return Math.min(closing, opening + 1);
  return closing;
}

/** Spread between shots in a fan, radians. */
const FAN_SPREAD = 0.2;

const DRIFTER_SPEED = 46;
const DRIFTER_BOB = 34;
const DIVER_ACCEL = 500;
const DIVER_MAX_SPEED = 240;
const DIVER_TRIGGER_RANGE = 460;

/*
 * Runners: the ones that come at you along the ground.
 *
 * Every other attacker owns the air, which meant the safest place on the level
 * was down among the caches, and the caches are supposed to be the dangerous
 * part. A runner makes the floor cost something.
 *
 * It is fast and it fires flat, so the shot arrives along the terrain rather
 * than down at you, and the answer is to climb rather than to strafe. That is
 * the one thing nothing else in the game asks for, which is the whole reason it
 * earns a place: a new enemy that wants the same response as an old one is a
 * reskin.
 */
const RUNNER_SPEED = 148;
const RUNNER_RANGE = 640;
/** Ride height above the chart, so it reads as driving rather than sliding. */
const RUNNER_CLEARANCE = 22;

/**
 * How wide a patrol car is, for collision and for being shot.
 *
 * Matches the player's own car, because two vehicles of visibly the same size
 * behaving as different sizes is the kind of inconsistency players feel without
 * being able to name.
 */
export const PATROL_CAR_RADIUS = 32;

/**
 * How big a target this one is.
 *
 * A car-borne attacker is hit anywhere on the vehicle. That is the point: you
 * should not have to pick out the driver through a windscreen, and a round that
 * visibly strikes the car has to count. It makes them easier to hit than a
 * person on foot, which is the trade for them being faster and seeing further.
 */
export function radiusOf(enemy: Enemy): number {
  if (enemy.driving) return PATROL_CAR_RADIUS;
  return enemy.kind === 'turret' ? TURRET_RADIUS : ENEMY_RADIUS;
}

export function updateEnemies(state: RunState, dt: number): void {
  const player = state.player;
  // Extreme fear means faster, angrier attackers. The market sets the tempo.
  /*
   * A woken level shoots faster.
   *
   * Applied to the shared aggression rather than to each kind, so being caught
   * costs the same everywhere and there is one number to reason about. Divided
   * rather than multiplied because the scale is a reload TIME multiplier: a
   * smaller number means a shorter wait.
   */
  const aggression =
    (0.7 + state.mission.difficulty * 0.16) / (alerted(state) ? ALERT_FIRE_SCALE : 1);

  /*
   * A city has its own rules and none of these apply.
   *
   * Every behaviour below is defined against a ground line and a forward axis,
   * and waking is keyed to a difference in x, which in a map thousands wide
   * woke a vertical strip rather than the neighbourhood the player is in. From
   * inside that reads as a city where nothing ever comes. See game/patrol.ts.
   */
  /*
   * Any world without a left-to-right ground line patrols instead.
   *
   * This used to test `city`, so the ring finale fell through to the path
   * below, which wakes an attacker when `enemy.x - player.x` drops under a
   * threshold and abandons it once the player is far enough past. Both assume
   * the level runs left to right and the player advances along it.
   *
   * The ring city runs inward. The player's x barely changes for a whole run,
   * so the waking test picked out a vertical strip of a world 5,800 across and
   * the abandon test discarded most of what was left. Played end to end on a
   * phone without meeting a single attacker, on a stage that had thirty of them
   * standing in it.
   *
   * The comment above already described this exact failure for cities. The
   * finale simply never got the same treatment.
   */
  if (state.freeWorld) {
    for (const enemy of state.enemies) updatePatrol(state, enemy, dt);
    return;
  }

  for (const enemy of state.enemies) {
    if (!enemy.alive) continue;

    if (!enemy.active) {
      /*
       * The transport wakes attackers too.
       *
       * This was the bug that made stage five a progress bar. Waking was keyed
       * to the player alone, so a convoy that got ahead sailed straight past a
       * line of dormant attackers who never woke, never fired, and never
       * threatened the one thing the stage is about. It reached the pad
       * untouched and waited. An escort you cannot endanger is not a mission.
       */
      const convoy = state.convoy;
      const nearConvoy =
        convoy !== null &&
        !convoy.arrived &&
        convoy.health > 0 &&
        enemy.x - convoy.x < ACTIVATION_RANGE;

      if (enemy.x - player.x < ACTIVATION_RANGE || nearConvoy) enemy.active = true;
      else continue;
    }

    if (player.x - enemy.x > ABANDON_RANGE) continue;

    enemy.phase += dt;

    switch (enemy.kind) {
      case 'drifter':
        updateDrifter(state, enemy, dt, aggression);
        break;
      case 'diver':
        updateDiver(state, enemy, dt, aggression);
        break;
      case 'turret':
        updateTurret(state, enemy, dt, aggression);
        break;
      case 'runner':
        updateRunner(state, enemy, dt, aggression);
        break;
    }
  }
}

function updateDrifter(state: RunState, enemy: Enemy, dt: number, aggression: number): void {
  const player = state.player;

  // Close the horizontal gap slowly and bob on a sine, so it reads as hovering
  // rather than charging. The bob is off the placement height, not the current
  // one, or the drift and the bob compound and it wanders off screen.
  const toward = Math.sign(player.x - enemy.x);
  enemy.x += toward * DRIFTER_SPEED * dt;
  enemy.y = enemy.homeY + Math.sin(enemy.phase * 1.6) * DRIFTER_BOB;
  enemy.y = clampToWorld(enemy.y);

  enemy.fireCooldown -= dt * aggression;
  if (enemy.fireCooldown > 0) return;

  /*
   * Opened up from 1.4 to 2.6 seconds.
   *
   * With thirty-odd attackers on a level and a third of them awake at once,
   * the old rate put more in the air than anyone could read, and the screen
   * stopped being a place you could plan a route through. Drifters always fire
   * a single aimed shot: the escalating fan belongs to turrets, which are
   * stationary and therefore avoidable.
   */
  enemy.fireCooldown = state.runRng.range(2.2, 3.4);

  const unit = direction(enemy.x, enemy.y, player.x, player.y);
  spawnBullet(state, {
    x: enemy.x + unit.x * 18,
    y: enemy.y + unit.y * 18,
    vx: unit.x * ENEMY_BULLET_SPEED,
    vy: unit.y * ENEMY_BULLET_SPEED,
    life: 3,
    damage: ENEMY_BULLET_DAMAGE,
    friendly: false,
  });
}

function updateDiver(state: RunState, enemy: Enemy, dt: number, aggression: number): void {
  const player = state.player;

  if (!withinRange(enemy.x, enemy.y, player.x, player.y, DIVER_TRIGGER_RANGE)) {
    // Idle drift back toward its lane so it does not sink into the ground
    // while it waits.
    enemy.vy += (enemy.homeY - enemy.y) * 1.4 * dt;
    enemy.vx *= 0.94;
    enemy.vy *= 0.94;
  } else {
    const unit = direction(enemy.x, enemy.y, player.x, player.y);
    enemy.vx += unit.x * DIVER_ACCEL * aggression * dt;
    enemy.vy += unit.y * DIVER_ACCEL * aggression * dt;

    const speed = Math.hypot(enemy.vx, enemy.vy);
    const cap = DIVER_MAX_SPEED * aggression;
    if (speed > cap) {
      enemy.vx = (enemy.vx / speed) * cap;
      enemy.vy = (enemy.vy / speed) * cap;
    }
  }

  enemy.x += enemy.vx * dt;
  enemy.y += enemy.vy * dt;

  // A diver that buries itself in a hill is a diver you cannot shoot back at.
  const ground = state.terrain.groundAt(enemy.x) - ENEMY_RADIUS;
  if (enemy.y > ground) {
    enemy.y = ground;
    enemy.vy = Math.min(enemy.vy, 0);
  }
  enemy.y = clampToWorld(enemy.y);
}

/**
 * A runner drives the chart toward you and shoots along it.
 *
 * It only fires when you are roughly level with it, which is what makes
 * climbing the answer. Sitting above a runner is safe and sitting in its lane
 * is not, so it converts altitude from a preference into a decision.
 */
function updateRunner(state: RunState, enemy: Enemy, dt: number, aggression: number): void {
  const player = state.player;

  const toward = Math.sign(player.x - enemy.x) || 1;
  enemy.x += toward * RUNNER_SPEED * aggression * dt;
  enemy.vx = toward * RUNNER_SPEED;

  // Rides the terrain exactly, so it climbs and drops with the day's chart.
  enemy.y = state.terrain.groundAt(enemy.x) - RUNNER_CLEARANCE;

  enemy.fireCooldown -= dt * aggression;
  if (enemy.fireCooldown > 0) return;
  if (!withinRange(enemy.x, enemy.y, player.x, player.y, RUNNER_RANGE)) return;

  // Nothing to shoot at if you are well above it. This is the dodge.
  if (enemy.y - player.y > 150) return;

  enemy.fireCooldown = state.runRng.range(1.6, 2.6);

  const unit = direction(enemy.x, enemy.y, player.x, player.y);
  spawnBullet(state, {
    x: enemy.x + unit.x * 20,
    y: enemy.y + unit.y * 20 - 6,
    // Faster and flatter than anything else fired at you, because it has to
    // cross open ground before you can simply climb out of its lane.
    vx: unit.x * ENEMY_BULLET_SPEED * 1.25,
    vy: unit.y * ENEMY_BULLET_SPEED * 1.25,
    life: 2.2,
    damage: ENEMY_BULLET_DAMAGE,
    friendly: false,
  });
}

function updateTurret(state: RunState, enemy: Enemy, dt: number, aggression: number): void {
  const player = state.player;

  // Turrets ride the chart. If the ground moved, the turret moved with it.
  enemy.y = state.terrain.groundAt(enemy.x) - 26;

  enemy.fireCooldown -= dt * aggression;
  if (enemy.fireCooldown > 0) return;
  if (!withinRange(enemy.x, enemy.y, player.x, player.y, 700)) return;

  enemy.fireCooldown = state.runRng.range(2.4, 3.6);

  const unit = direction(enemy.x, enemy.y, player.x, player.y);
  const base = Math.atan2(unit.y, unit.x);

  // One shot early, a fan later. See volleyAt.
  const shots = volleyAt(state);
  const offsets =
    shots === 1 ? [0] : shots === 2 ? [-FAN_SPREAD / 2, FAN_SPREAD / 2] : [-FAN_SPREAD, 0, FAN_SPREAD];

  for (const offset of offsets) {
    const angle = base + offset;
    spawnBullet(state, {
      x: enemy.x + Math.cos(angle) * 22,
      y: enemy.y + Math.sin(angle) * 22,
      vx: Math.cos(angle) * ENEMY_BULLET_SPEED * 0.9,
      vy: Math.sin(angle) * ENEMY_BULLET_SPEED * 0.9,
      life: 3,
      damage: ENEMY_BULLET_DAMAGE,
      friendly: false,
    });
  }
}

export function damageEnemy(state: RunState, enemy: Enemy, amount: number): void {
  if (!enemy.alive) return;

  enemy.health -= amount;
  state.emit({ kind: 'hit', x: enemy.x, y: enemy.y });

  /*
   * Being shot wakes you up.
   *
   * Without this, hitting an unaware patrol would leave it walking its beat
   * while its health drained, which reads as a bug even though the damage is
   * landing. It also has to be here rather than at the call site, because every
   * source of damage should have the same effect: a bomb, a squadmate's round
   * and your own shot all announce your presence equally.
   */
  enemy.active = true;
  enemy.notice = 1;
  enemy.alertUntil = Math.max(enemy.alertUntil, state.time + 3);

  if (enemy.health <= 0) {
    enemy.alive = false;
    state.attackersCleared++;
    // The drop was decided when the level was laid out, so paying it here
    // cannot consume a random draw and cannot diverge between two players.
    earn(state.purse, enemy.drop);
    state.emit({
      kind: 'kill',
      x: enemy.x,
      y: enemy.y,
      text: enemy.drop > 0 ? `+${enemy.drop}` : undefined,
    });
  }
}

/** True when any live, woken attacker is within range. Madam Cold Storage asks. */
export function threatNear(state: RunState, x: number, y: number, range: number): boolean {
  return state.enemies.some(
    (enemy) => enemy.alive && enemy.active && withinRange(enemy.x, enemy.y, x, y, range),
  );
}

function clampToWorld(y: number): number {
  return Math.min(WORLD_HEIGHT - 40, Math.max(CEILING + 20, y));
}

export { ATTACKER_SCORE };
