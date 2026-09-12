import { PerspectiveCamera, Vector3 } from 'three';
import type { AtlasCityFacing } from '../../../../shared/atlas/city/player';
import type { AtlasCityCollider } from '../../../../shared/atlas/city/types';

export interface AtlasCameraRigOptions {
  readonly fieldOfViewDegrees?: number;
  readonly targetPlayerScreenHeightPercent?: number;
  readonly avatarHeightMeters?: number;
  readonly pitchDegrees?: number;
  /** Overrides the solved distance. Leave unset so framing stays the input. */
  readonly followDistanceMeters?: number;
  readonly cameraHeightMeters?: number;
  readonly shoulderOffsetMeters?: number;
  readonly lookAheadMeters?: number;
}

export interface AtlasFollowGeometry {
  /** Camera to aim-point distance, which is what sets projected size. */
  readonly slantDistanceMeters: number;
  /** Horizontal component, behind the player. */
  readonly followDistanceMeters: number;
  /** Vertical component, above the aim point. */
  readonly cameraLiftMeters: number;
}

export interface AtlasCameraFrame {
  readonly mode?: 'follow' | 'overview';
  readonly reducedMotion?: boolean;
  readonly width: number;
  readonly height: number;
  readonly deltaSeconds: number;
  readonly playerPosition?: Vector3;
  readonly playerFacing?: AtlasCityFacing;
  readonly playerHeadingRadians?: number;
  readonly cameraHeadingRadians?: number;
  readonly playerMoving?: boolean;
  readonly playerRunning?: boolean;
  readonly obstructionDistance?: number;
  readonly colliders?: readonly AtlasCityCollider[];
}

const DEFAULT_PLAYER_POSITION = new Vector3(0, 0, 4.2);
const DEFAULT_HEADING_RADIANS = Math.PI;

/*
 * The avatar stands 1.76 m in
 * art/atlas/characters/atlas-walker-v1/character-spec.json, scaled by
 * PLAYER_WORLD_SCALE 0.72 in three-renderer.ts. The previous aim height of
 * 1.42 m was therefore 15 cm above the top of its head, which is part of why
 * the avatar sat low in frame while the lens pointed at empty street.
 */
export const ATLAS_AVATAR_WORLD_HEIGHT_METERS = 1.76 * 0.72;

/*
 * How much of the viewport's height the avatar should fill.
 *
 * 0.175 was tuned in portrait and is correct there. Held constant it is wrong
 * in landscape, because the solve targets a *fraction* of viewport height and
 * landscape has far less of it: measured on a Pixel 7 Pro, the avatar is 162
 * px tall in portrait (923 px viewport) and 70 px in landscape (401 px), so it
 * renders at 43 percent of the size while the camera sits at the same 6.27 m.
 * Proportionally identical, and much too small to read in the hand.
 *
 * So the fraction grows as the viewport gets shorter, bounded at both ends:
 * portrait is left exactly as tuned, and the ceiling stops a very short
 * viewport from pushing the camera into the avatar's back.
 */
export const ATLAS_FRAMING_REFERENCE_HEIGHT_PX = 900;
export const ATLAS_FRAMING_MIN_PERCENT = 0.175;
export const ATLAS_FRAMING_MAX_PERCENT = 0.3;

export function atlasFramingTargetPercent(viewportHeightPx: number): number {
  if (!Number.isFinite(viewportHeightPx) || viewportHeightPx <= 0) return ATLAS_FRAMING_MIN_PERCENT;
  const scaled = ATLAS_FRAMING_MIN_PERCENT * (ATLAS_FRAMING_REFERENCE_HEIGHT_PX / viewportHeightPx);
  return Math.max(ATLAS_FRAMING_MIN_PERCENT, Math.min(ATLAS_FRAMING_MAX_PERCENT, scaled));
}

/**
 * The single owner of the camera's field of view.
 *
 * three-renderer.ts used to construct PerspectiveCamera with 50 while this rig
 * overwrote it with 60 in the constructor, so a tuned value silently did
 * nothing. Both sites read this constant now.
 */
export const ATLAS_CAMERA_FIELD_OF_VIEW_DEGREES = 52;

/** Aim at the upper torso, so the head is not pinned to the frame centre. */
const AIM_HEIGHT_FRACTION = 0.62;

/**
 * Owner-approved framing band, from
 * docs/superpowers/specs/2026-09-10-nim-atlas-round-2-design.md. Landed against
 * real captures by scripts/measure-atlas.mjs rather than by taste.
 */
export const ATLAS_FRAMING_BAND = Object.freeze({ minimum: 0.16, maximum: 0.19 });
const CAMERA_COLLISION_RADIUS_METERS = 0.24;
const CAMERA_WALL_PADDING_METERS = 0.16;
const MINIMUM_CAMERA_ARM_METERS = 0.32;
const CAMERA_ESCAPE_DISTANCE_METERS = 2.2;
const CAMERA_ESCAPE_MINIMUM_GAIN_METERS = 0.45;
const CAMERA_ESCAPE_ANGLES_RADIANS = [-0.58, 0.58, -1.05, 1.05] as const;

export class AtlasCameraRig {
  readonly fieldOfViewDegrees: number;
  readonly targetPlayerScreenHeightPercent: number;
  readonly avatarHeightMeters: number;
  readonly pitchDegrees: number;
  readonly aimHeightMeters: number;
  /* Re-solved by `resize` when the viewport height changes, so these three are
     no longer fixed for the life of the rig. See frameForViewport. */
  followDistanceMeters: number;
  cameraLiftMeters: number;
  cameraHeightMeters: number;
  readonly shoulderOffsetMeters: number;
  readonly lookAheadMeters: number;
  private readonly currentTarget = new Vector3();
  private readonly desiredTarget = new Vector3();
  private readonly desiredPosition = new Vector3();
  private readonly obstructionPosition = new Vector3();
  private readonly cameraPivot = new Vector3();
  private readonly cameraOffset = new Vector3();
  private readonly forward = new Vector3();
  private readonly right = new Vector3();
  private readonly escapeForward = new Vector3();
  private readonly escapeRight = new Vector3();
  private readonly escapePosition = new Vector3();
  private readonly bestEscapePosition = new Vector3();
  private currentHeadingRadians = DEFAULT_HEADING_RADIANS;
  private currentFovDegrees: number;
  private readonly framingIsAutomatic: boolean;
  private framedForHeightPx = 0;

  constructor(private readonly camera: PerspectiveCamera, options: AtlasCameraRigOptions = {}) {
    this.fieldOfViewDegrees = options.fieldOfViewDegrees ?? ATLAS_CAMERA_FIELD_OF_VIEW_DEGREES;
    this.targetPlayerScreenHeightPercent = options.targetPlayerScreenHeightPercent ?? 0.175;
    this.avatarHeightMeters = options.avatarHeightMeters ?? ATLAS_AVATAR_WORLD_HEIGHT_METERS;
    this.pitchDegrees = options.pitchDegrees ?? 31;
    this.aimHeightMeters = this.avatarHeightMeters * AIM_HEIGHT_FRACTION;
    const geometry = solveAtlasFollowGeometry({
      avatarHeightMeters: this.avatarHeightMeters,
      targetScreenHeightPercent: this.targetPlayerScreenHeightPercent,
      fieldOfViewDegrees: this.fieldOfViewDegrees,
      pitchDegrees: this.pitchDegrees,
    });
    this.framingIsAutomatic = options.followDistanceMeters === undefined && options.cameraHeightMeters === undefined;
    this.followDistanceMeters = options.followDistanceMeters ?? geometry.followDistanceMeters;
    this.cameraLiftMeters =
      options.cameraHeightMeters === undefined ? geometry.cameraLiftMeters : options.cameraHeightMeters - this.aimHeightMeters;
    this.cameraHeightMeters = this.aimHeightMeters + this.cameraLiftMeters;
    this.shoulderOffsetMeters = options.shoulderOffsetMeters ?? 0.52;
    this.lookAheadMeters = options.lookAheadMeters ?? 1.5;
    this.currentFovDegrees = this.fieldOfViewDegrees;
    this.camera.fov = this.currentFovDegrees;
    this.updateBasis();
    this.placeDesiredCamera(DEFAULT_PLAYER_POSITION);
    this.camera.position.copy(this.desiredPosition);
    this.currentTarget.copy(this.desiredTarget);
    this.camera.lookAt(this.currentTarget);
  }

  update(frame: AtlasCameraFrame): void {
    const safeWidth = Math.max(1, frame.width);
    const safeHeight = Math.max(1, frame.height);
    const playerPosition = frame.playerPosition ?? DEFAULT_PLAYER_POSITION;
    const headingBlend = dampingFactor(frame.deltaSeconds, frame.playerMoving ? 9 : 6.5);
    const targetHeading = Number.isFinite(frame.cameraHeadingRadians)
      ? frame.cameraHeadingRadians!
      : Number.isFinite(frame.playerHeadingRadians)
      ? frame.playerHeadingRadians!
      : headingFor(frame.playerFacing ?? 'up');
    this.currentHeadingRadians = dampAngle(this.currentHeadingRadians, targetHeading, headingBlend);
    this.updateBasis();
    this.placeDesiredCamera(playerPosition);
    if (frame.mode === 'overview') {
      this.desiredPosition.copy(playerPosition).addScaledVector(this.forward, -7);
      this.desiredPosition.y += 12;
      this.desiredTarget.copy(playerPosition);
    } else if (frame.width < frame.height) {
      /*
       * Recentre the player in a narrow WebView instead of cropping the action
       * sideways. This used to also add 0.8 m of camera lift, which changed the
       * avatar's projected size and so fought the framing solver. Vertical
       * placement is the look-ahead's job now, because moving the aim point
       * shifts the avatar in frame without resizing it.
       */
      this.desiredPosition.addScaledVector(this.right, -this.shoulderOffsetMeters);
    }
    const escapedCloseWall = this.avoidCloseObstruction(playerPosition, frame.colliders ?? []);

    this.camera.aspect = safeWidth / safeHeight;
    const desiredFov = this.fieldOfViewDegrees + (frame.reducedMotion ? 0 : frame.playerRunning ? 3.5 : frame.playerMoving ? 1.5 : 0);
    const fovBlend = dampingFactor(frame.deltaSeconds, frame.playerRunning ? 4.8 : 3.6);
    this.currentFovDegrees += (desiredFov - this.currentFovDegrees) * fovBlend;
    this.camera.fov = this.currentFovDegrees;
    this.camera.updateProjectionMatrix();

    const targetBlend = dampingFactor(frame.deltaSeconds, 11);
    const positionBlend = dampingFactor(frame.deltaSeconds, 9);
    this.currentTarget.lerp(this.desiredTarget, targetBlend);

    this.cameraPivot.copy(playerPosition);
    this.cameraPivot.y += this.aimHeightMeters;
    this.cameraOffset.copy(this.desiredPosition).sub(this.cameraPivot);
    const cameraDistance = this.cameraOffset.length();
    const colliderDistance = nearestCameraObstructionDistance(this.cameraPivot, this.desiredPosition, frame.colliders ?? []);
    const explicitDistance = Number.isFinite(frame.obstructionDistance) ? frame.obstructionDistance! : Number.POSITIVE_INFINITY;
    const obstructionDistance = Math.min(explicitDistance, colliderDistance ?? Number.POSITIVE_INFINITY);
    if (Number.isFinite(obstructionDistance) && obstructionDistance > 0 && obstructionDistance < cameraDistance) {
      const safeDistance = Math.max(MINIMUM_CAMERA_ARM_METERS, obstructionDistance - CAMERA_WALL_PADDING_METERS);
      this.obstructionPosition.copy(this.cameraPivot).add(this.cameraOffset.normalize().multiplyScalar(safeDistance));
    } else {
      this.obstructionPosition.copy(this.desiredPosition);
    }
    const currentArmDistance = this.camera.position.distanceTo(this.cameraPivot);
    const targetArmDistance = this.obstructionPosition.distanceTo(this.cameraPivot);
    this.camera.position.lerp(this.obstructionPosition, targetArmDistance < currentArmDistance || escapedCloseWall ? 1 : positionBlend);
    this.camera.lookAt(this.currentTarget);
  }

  resize(width: number, height: number): void {
    this.camera.aspect = Math.max(1, width) / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.frameForViewport(height);
  }

  /*
   * Re-solve the follow distance for this viewport.
   *
   * The geometry used to be solved once in the constructor and never revisited,
   * so rotating the phone changed the aspect and nothing else. A rig given an
   * explicit distance or height is left alone: that is a caller pinning the
   * shot, and resizing is not a reason to overrule it.
   */
  private frameForViewport(height: number): void {
    if (!this.framingIsAutomatic) return;
    const safeHeight = Math.max(1, height);
    if (Math.abs(safeHeight - this.framedForHeightPx) < 1) return;
    this.framedForHeightPx = safeHeight;
    const geometry = solveAtlasFollowGeometry({
      avatarHeightMeters: this.avatarHeightMeters,
      targetScreenHeightPercent: atlasFramingTargetPercent(safeHeight),
      fieldOfViewDegrees: this.fieldOfViewDegrees,
      pitchDegrees: this.pitchDegrees,
    });
    this.followDistanceMeters = geometry.followDistanceMeters;
    this.cameraLiftMeters = geometry.cameraLiftMeters;
    this.cameraHeightMeters = this.aimHeightMeters + this.cameraLiftMeters;
  }

  private updateBasis(): void {
    this.forward.set(Math.sin(this.currentHeadingRadians), 0, Math.cos(this.currentHeadingRadians)).normalize();
    this.right.set(-this.forward.z, 0, this.forward.x).normalize();
  }

  private placeDesiredCamera(playerPosition: Vector3): void {
    this.desiredTarget.copy(playerPosition).addScaledVector(this.forward, this.lookAheadMeters);
    this.desiredTarget.y += this.aimHeightMeters;
    this.desiredPosition.copy(playerPosition).addScaledVector(this.forward, -this.followDistanceMeters).addScaledVector(this.right, this.shoulderOffsetMeters);
    this.desiredPosition.y += this.cameraHeightMeters;
  }

  private avoidCloseObstruction(playerPosition: Vector3, colliders: readonly AtlasCityCollider[]): boolean {
    if (colliders.length === 0) return false;
    this.cameraPivot.copy(playerPosition);
    this.cameraPivot.y += this.aimHeightMeters;
    const directArmDistance = this.desiredPosition.distanceTo(this.cameraPivot);
    const directObstruction = nearestCameraObstructionDistance(this.cameraPivot, this.desiredPosition, colliders);
    const directClearance = Math.min(directArmDistance, directObstruction ?? directArmDistance);
    if (directClearance >= CAMERA_ESCAPE_DISTANCE_METERS) return false;

    let bestClearance = directClearance;
    this.bestEscapePosition.copy(this.desiredPosition);
    for (const angleOffset of CAMERA_ESCAPE_ANGLES_RADIANS) {
      const heading = this.currentHeadingRadians + angleOffset;
      this.escapeForward.set(Math.sin(heading), 0, Math.cos(heading)).normalize();
      this.escapeRight.set(-this.escapeForward.z, 0, this.escapeForward.x).normalize();
      this.escapePosition
        .copy(playerPosition)
        .addScaledVector(this.escapeForward, -this.followDistanceMeters)
        .addScaledVector(this.escapeRight, this.shoulderOffsetMeters);
      this.escapePosition.y += this.cameraHeightMeters;
      const armDistance = this.escapePosition.distanceTo(this.cameraPivot);
      const obstruction = nearestCameraObstructionDistance(this.cameraPivot, this.escapePosition, colliders);
      const clearance = Math.min(armDistance, obstruction ?? armDistance);
      if (clearance > bestClearance) {
        bestClearance = clearance;
        this.bestEscapePosition.copy(this.escapePosition);
      }
    }
    if (bestClearance < directClearance + CAMERA_ESCAPE_MINIMUM_GAIN_METERS) return false;
    this.desiredPosition.copy(this.bestEscapePosition);
    return true;
  }
}

/**
 * Solve the follow geometry that projects an avatar at a requested fraction of
 * viewport height.
 *
 * This exists because the rig previously accepted
 * targetPlayerScreenHeightPercent, stored it, and never read it, so framing was
 * an emergent property of three independently tuned numbers. Making the goal
 * the input means it holds on every aspect ratio rather than only on the one
 * device it was eyeballed on.
 *
 * Vertical field of view is aspect independent in three.js, so viewport width
 * does not enter the solve.
 */
export function solveAtlasFollowGeometry(input: {
  readonly avatarHeightMeters: number;
  readonly targetScreenHeightPercent: number;
  readonly fieldOfViewDegrees: number;
  readonly pitchDegrees: number;
}): AtlasFollowGeometry {
  const halfFovRadians = (Math.max(1, Math.min(input.fieldOfViewDegrees, 170)) / 2) * (Math.PI / 180);
  const target = Math.max(0.01, Math.min(input.targetScreenHeightPercent, 0.9));
  const slantDistanceMeters = input.avatarHeightMeters / (2 * target * Math.tan(halfFovRadians));
  const pitchRadians = Math.max(0, Math.min(input.pitchDegrees, 85)) * (Math.PI / 180);
  return Object.freeze({
    slantDistanceMeters,
    followDistanceMeters: slantDistanceMeters * Math.cos(pitchRadians),
    cameraLiftMeters: slantDistanceMeters * Math.sin(pitchRadians),
  });
}

/** The fraction of viewport height an avatar occupies at a given distance. */
export function projectedAtlasScreenHeightPercent(input: {
  readonly avatarHeightMeters: number;
  readonly slantDistanceMeters: number;
  readonly fieldOfViewDegrees: number;
}): number {
  const halfFovRadians = (Math.max(1, Math.min(input.fieldOfViewDegrees, 170)) / 2) * (Math.PI / 180);
  const visibleHeight = 2 * Math.max(0.0001, input.slantDistanceMeters) * Math.tan(halfFovRadians);
  return input.avatarHeightMeters / visibleHeight;
}

export function nearestCameraObstructionDistance(
  origin: Vector3,
  destination: Vector3,
  colliders: readonly AtlasCityCollider[],
): number | undefined {
  const dx = destination.x - origin.x;
  const dy = destination.y - origin.y;
  const dz = destination.z - origin.z;
  const segmentLength = Math.hypot(dx, dy, dz);
  if (!Number.isFinite(segmentLength) || segmentLength <= 0.0001) return undefined;
  const directionX = dx / segmentLength;
  const directionY = dy / segmentLength;
  const directionZ = dz / segmentLength;
  let nearest = Number.POSITIVE_INFINITY;
  for (const collider of colliders) {
    const distance = rayAabbEntryDistance(origin, directionX, directionY, directionZ, segmentLength, collider);
    if (distance !== undefined && distance < nearest) nearest = distance;
  }
  return Number.isFinite(nearest) ? nearest : undefined;
}

function rayAabbEntryDistance(
  origin: Vector3,
  directionX: number,
  directionY: number,
  directionZ: number,
  maximumDistance: number,
  collider: AtlasCityCollider,
): number | undefined {
  const halfX = collider.size[0] / 2 + CAMERA_COLLISION_RADIUS_METERS;
  const halfY = collider.size[1] / 2 + CAMERA_COLLISION_RADIUS_METERS;
  const halfZ = collider.size[2] / 2 + CAMERA_COLLISION_RADIUS_METERS;
  let entry = 0;
  let exit = maximumDistance;
  const axes = [
    [origin.x, directionX, collider.position[0] - halfX, collider.position[0] + halfX],
    [origin.y, directionY, collider.position[1] - halfY, collider.position[1] + halfY],
    [origin.z, directionZ, collider.position[2] - halfZ, collider.position[2] + halfZ],
  ] as const;
  for (const [axisOrigin, axisDirection, minimum, maximum] of axes) {
    if (Math.abs(axisDirection) < 0.000001) {
      if (axisOrigin < minimum || axisOrigin > maximum) return undefined;
      continue;
    }
    const inverse = 1 / axisDirection;
    const first = (minimum - axisOrigin) * inverse;
    const second = (maximum - axisOrigin) * inverse;
    entry = Math.max(entry, Math.min(first, second));
    exit = Math.min(exit, Math.max(first, second));
    if (entry > exit) return undefined;
  }
  return entry <= maximumDistance ? entry : undefined;
}

function headingFor(facing: AtlasCityFacing): number {
  return {
    up: Math.PI,
    down: 0,
    left: -Math.PI / 2,
    right: Math.PI / 2,
  }[facing];
}

function dampAngle(current: number, target: number, amount: number): number {
  const shortestDelta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + shortestDelta * amount;
}

function dampingFactor(deltaSeconds: number, stiffness: number): number {
  const safeDelta = Number.isFinite(deltaSeconds) ? Math.max(0, Math.min(deltaSeconds, 0.25)) : 0;
  return 1 - Math.exp(-stiffness * safeDelta);
}
