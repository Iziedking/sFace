import type { AtlasCityCollider } from './types';

export type AtlasCityFacing = 'up' | 'down' | 'left' | 'right';
export type AtlasCityPace = 'idle' | 'walk' | 'run';

export interface AtlasCityPlayerState {
  readonly x: number;
  readonly z: number;
  readonly facing: AtlasCityFacing;
  readonly headingRadians: number;
  readonly moving: boolean;
  readonly pace: AtlasCityPace;
  readonly speed01: number;
  readonly speedUnitsPerSecond: number;
  readonly velocityX: number;
  readonly velocityZ: number;
  readonly runIntentSeconds: number;
  readonly cameraHeadingRadians: number;
}

export interface AtlasCityMovement {
  readonly moveX: number;
  readonly moveY: number;
  readonly run?: boolean;
}

export interface AtlasCityWalkBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

const WALK_SPEED_UNITS_PER_SECOND = 1.15;
const RUN_SPEED_UNITS_PER_SECOND = 2.4;
const MOVEMENT_DEAD_ZONE = 0.12;
const RUN_ENTER_THRESHOLD = 0.86;
const RUN_EXIT_THRESHOLD = 0.7;
const RUN_HOLD_SECONDS = 0.32;
const MINIMUM_WALK_SPEED_UNITS_PER_SECOND = 0.52;
const MINIMUM_RUN_SPEED_UNITS_PER_SECOND = 1.72;
const WALK_ACCELERATION_UNITS_PER_SECOND_SQUARED = 3.8;
const RUN_ACCELERATION_UNITS_PER_SECOND_SQUARED = 5.8;
const BRAKING_UNITS_PER_SECOND_SQUARED = 6.2;
const STOP_SPEED_UNITS_PER_SECOND = 0.045;
const PLAYER_RADIUS = 0.34;

/**
 * How fast the character is allowed to rotate, in radians per second so the
 * limit is identical on a 30 fps phone and a 60 fps desktop.
 *
 * Why this exists, because the cause is not where the symptom points. Heading
 * is read off the velocity vector with Math.atan2, and velocity legitimately
 * passes through zero during a stick reversal. At that instant the direction is
 * undefined, and on the next frame the character was snapping a full 180
 * degrees in 33 milliseconds while still moving at 0.113 units per second.
 * Measured 2026-09-02 at frames 11 to 12 of a full reversal from a run.
 *
 * The tell that separates this from an input problem: raw input is already
 * smoothed, because acceleration limits how fast velocity can change. Only the
 * zero crossing produces the jump, so a fix applied to input would have
 * changed nothing.
 *
 * Running turns slower than walking because a body at speed cannot pivot, and
 * that difference is most of what reads as weight.
 */
const WALK_TURN_RADIANS_PER_SECOND = 11;
const RUN_TURN_RADIANS_PER_SECOND = 6.5;

export function createAtlasCityPlayer(initial: Pick<AtlasCityPlayerState, 'x' | 'z' | 'facing'>): AtlasCityPlayerState {
  assertFinite(initial.x, 'player x');
  assertFinite(initial.z, 'player z');
  const headingRadians = headingForFacing(initial.facing);
  return {
    ...initial,
    headingRadians,
    cameraHeadingRadians: headingRadians,
    moving: false,
    pace: 'idle',
    speed01: 0,
    speedUnitsPerSecond: 0,
    velocityX: 0,
    velocityZ: 0,
    runIntentSeconds: 0,
  };
}

export function cameraRelativeMovement(input: AtlasCityMovement, cameraHeadingRadians: number): AtlasCityMovement {
  assertFinite(cameraHeadingRadians, 'camera heading');
  const right = finiteOr(input.moveX, 0);
  const forward = -finiteOr(input.moveY, 0);
  return {
    moveX: right * -Math.cos(cameraHeadingRadians) + forward * Math.sin(cameraHeadingRadians),
    moveY: right * Math.sin(cameraHeadingRadians) + forward * Math.cos(cameraHeadingRadians),
    run: input.run,
  };
}

export function stepAtlasCityPlayer(
  state: AtlasCityPlayerState,
  input: AtlasCityMovement,
  deltaSeconds: number,
  bounds: AtlasCityWalkBounds,
  colliders: readonly AtlasCityCollider[] = [],
  safeSpawn?: Readonly<{ x: number; z: number }>,
): AtlasCityPlayerState {
  const recovered = recoverPlayer(state, bounds, colliders, safeSpawn);
  const xInput = normalizeAxis(input.moveX);
  const zInput = normalizeAxis(input.moveY);
  const magnitude = Math.hypot(xInput, zInput);
  const delta = Math.min(0.1, Math.max(0, finiteOr(deltaSeconds, 0)));
  const hasInput = magnitude > MOVEMENT_DEAD_ZONE;
  const inputStrength = hasInput ? clamp((Math.min(1, magnitude) - MOVEMENT_DEAD_ZONE) / (1 - MOVEMENT_DEAD_ZONE), 0, 1) : 0;
  const runThreshold = recovered.pace === 'run' ? RUN_EXIT_THRESHOLD : RUN_ENTER_THRESHOLD;
  const runRequested = hasInput && Boolean(input.run || inputStrength >= runThreshold);
  const runIntentSeconds = runRequested ? recovered.runIntentSeconds + delta : 0;
  const runEngaged = Boolean(input.run) || runIntentSeconds >= RUN_HOLD_SECONDS;
  const targetSpeed = !hasInput
    ? 0
    : runEngaged
    ? interpolate(MINIMUM_RUN_SPEED_UNITS_PER_SECOND, RUN_SPEED_UNITS_PER_SECOND, inputStrength)
    : interpolate(MINIMUM_WALK_SPEED_UNITS_PER_SECOND, WALK_SPEED_UNITS_PER_SECOND, inputStrength);
  const directionScale = hasInput ? 1 / magnitude : 0;
  const targetVelocityX = xInput * directionScale * targetSpeed;
  const targetVelocityZ = zInput * directionScale * targetSpeed;
  const acceleration = !hasInput
    ? BRAKING_UNITS_PER_SECOND_SQUARED
    : runEngaged
    ? RUN_ACCELERATION_UNITS_PER_SECOND_SQUARED
    : WALK_ACCELERATION_UNITS_PER_SECOND_SQUARED;
  let [velocityX, velocityZ] = approachVector(
    recovered.velocityX,
    recovered.velocityZ,
    targetVelocityX,
    targetVelocityZ,
    acceleration * delta,
  );
  if (Math.hypot(velocityX, velocityZ) < STOP_SPEED_UNITS_PER_SECOND) {
    velocityX = 0;
    velocityZ = 0;
  }
  const deltaX = velocityX * delta;
  const deltaZ = velocityZ * delta;
  const distance = Math.hypot(deltaX, deltaZ);
  const substeps = Math.max(1, Math.ceil(distance / (PLAYER_RADIUS * 0.45)));
  const stepX = deltaX / substeps;
  const stepZ = deltaZ / substeps;
  let x = recovered.x;
  let z = recovered.z;
  let blockedX = false;
  let blockedZ = false;
  for (let index = 0; index < substeps; index += 1) {
    const candidateX = clamp(x + stepX, bounds.minX, bounds.maxX);
    if (!collides(candidateX, z, colliders)) x = candidateX;
    else blockedX = true;
    const candidateZ = clamp(z + stepZ, bounds.minZ, bounds.maxZ);
    if (!collides(x, candidateZ, colliders)) z = candidateZ;
    else blockedZ = true;
  }
  if (blockedX || (x === recovered.x && deltaX !== 0)) velocityX = 0;
  if (blockedZ || (z === recovered.z && deltaZ !== 0)) velocityZ = 0;
  const speedUnitsPerSecond = Math.hypot(velocityX, velocityZ);
  const moving = speedUnitsPerSecond >= STOP_SPEED_UNITS_PER_SECOND && (x !== recovered.x || z !== recovered.z);
  const pace: AtlasCityPace = !moving ? 'idle' : runEngaged && speedUnitsPerSecond > WALK_SPEED_UNITS_PER_SECOND * 1.18 ? 'run' : 'walk';
  const speed01 = pace === 'run'
    ? clamp((speedUnitsPerSecond - WALK_SPEED_UNITS_PER_SECOND) / (RUN_SPEED_UNITS_PER_SECOND - WALK_SPEED_UNITS_PER_SECOND), 0, 1)
    : pace === 'walk'
    ? clamp(speedUnitsPerSecond / WALK_SPEED_UNITS_PER_SECOND, 0, 1)
    : 0;
  return {
    x,
    z,
    facing: facingFor(deltaX, deltaZ, recovered.facing),
    headingRadians: steerHeading(recovered.headingRadians, moving ? Math.atan2(velocityX, velocityZ) : recovered.headingRadians, pace, delta),
    cameraHeadingRadians: recovered.cameraHeadingRadians,
    moving,
    pace,
    speed01,
    speedUnitsPerSecond: moving ? speedUnitsPerSecond : 0,
    velocityX: moving ? velocityX : 0,
    velocityZ: moving ? velocityZ : 0,
    runIntentSeconds: hasInput ? runIntentSeconds : 0,
  };
}

function recoverPlayer(
  state: AtlasCityPlayerState,
  bounds: AtlasCityWalkBounds,
  colliders: readonly AtlasCityCollider[],
  safeSpawn?: Readonly<{ x: number; z: number }>,
): AtlasCityPlayerState {
  if (insideBounds(state.x, state.z, bounds) && !collides(state.x, state.z, colliders)) return state;
  const spawn = safeSpawn ?? { x: clamp(state.x, bounds.minX, bounds.maxX), z: clamp(state.z, bounds.minZ, bounds.maxZ) };
  const x = clamp(spawn.x, bounds.minX, bounds.maxX);
  const z = clamp(spawn.z, bounds.minZ, bounds.maxZ);
  if (collides(x, z, colliders)) throw new Error('Atlas city safe spawn overlaps a collider.');
  return {
    ...state,
    x,
    z,
    moving: false,
    pace: 'idle',
    speed01: 0,
    speedUnitsPerSecond: 0,
    velocityX: 0,
    velocityZ: 0,
    runIntentSeconds: 0,
  };
}

function approachVector(
  currentX: number,
  currentZ: number,
  targetX: number,
  targetZ: number,
  maximumChange: number,
): [number, number] {
  const deltaX = targetX - currentX;
  const deltaZ = targetZ - currentZ;
  const distance = Math.hypot(deltaX, deltaZ);
  if (distance <= maximumChange || distance <= 0.000001) return [targetX, targetZ];
  const scale = maximumChange / distance;
  return [currentX + deltaX * scale, currentZ + deltaZ * scale];
}

function interpolate(start: number, end: number, amount: number): number {
  return start + (end - start) * clamp(amount, 0, 1);
}

function insideBounds(x: number, z: number, bounds: AtlasCityWalkBounds): boolean {
  return x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ;
}

function collides(x: number, z: number, colliders: readonly AtlasCityCollider[]): boolean {
  return colliders.some((collider) => {
    const halfX = collider.size[0] / 2 + PLAYER_RADIUS;
    const halfZ = collider.size[2] / 2 + PLAYER_RADIUS;
    if (collider.shape === 'box' || collider.shape === 'convex') {
      return Math.abs(x - collider.position[0]) < halfX && Math.abs(z - collider.position[2]) < halfZ;
    }
    const radius = Math.max(collider.size[0], collider.size[2]) / 2 + PLAYER_RADIUS;
    return Math.hypot(x - collider.position[0], z - collider.position[2]) < radius;
  });
}

function facingFor(deltaX: number, deltaZ: number, fallback: AtlasCityFacing): AtlasCityFacing {
  if (Math.abs(deltaZ) >= Math.abs(deltaX) && deltaZ < 0) return 'up';
  if (Math.abs(deltaZ) >= Math.abs(deltaX) && deltaZ > 0) return 'down';
  if (deltaX < 0) return 'left';
  if (deltaX > 0) return 'right';
  return fallback;
}

function headingForFacing(facing: AtlasCityFacing): number {
  return { up: Math.PI, down: 0, left: -Math.PI / 2, right: Math.PI / 2 }[facing];
}

function normalizeAxis(value: number): number {
  assertFinite(value, 'movement axis');
  return clamp(value / 127, -1, 1);
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`Atlas city ${label} must be finite.`);
}

function steerHeading(current: number, target: number, pace: AtlasCityPace, deltaSeconds: number): number {
  if (pace === 'idle') return current;
  const ceiling = (pace === 'run' ? RUN_TURN_RADIANS_PER_SECOND : WALK_TURN_RADIANS_PER_SECOND) * deltaSeconds;
  const difference = normalizeAngle(target - current);
  if (Math.abs(difference) <= ceiling) return normalizeAngle(target);
  return normalizeAngle(current + Math.sign(difference) * ceiling);
}

function normalizeAngle(value: number): number {
  return Math.atan2(Math.sin(value), Math.cos(value));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
