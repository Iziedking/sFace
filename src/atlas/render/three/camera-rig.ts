import { PerspectiveCamera, Vector3 } from 'three';
import type { AtlasCityFacing } from '../../../../shared/atlas/city/player';
import type { AtlasCityCollider } from '../../../../shared/atlas/city/types';

export interface AtlasCameraRigOptions {
  readonly fieldOfViewDegrees?: number;
  readonly targetPlayerScreenHeightPercent?: number;
  readonly followDistanceMeters?: number;
  readonly cameraHeightMeters?: number;
  readonly shoulderOffsetMeters?: number;
  readonly lookAheadMeters?: number;
}

export interface AtlasCameraFrame {
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
const TARGET_HEIGHT_METERS = 1.42;
const CAMERA_COLLISION_RADIUS_METERS = 0.24;
const CAMERA_WALL_PADDING_METERS = 0.16;
const MINIMUM_CAMERA_ARM_METERS = 0.32;
const CAMERA_ESCAPE_DISTANCE_METERS = 2.2;
const CAMERA_ESCAPE_MINIMUM_GAIN_METERS = 0.45;
const CAMERA_ESCAPE_ANGLES_RADIANS = [-0.58, 0.58, -1.05, 1.05] as const;

export class AtlasCameraRig {
  readonly fieldOfViewDegrees: number;
  readonly targetPlayerScreenHeightPercent: number;
  readonly followDistanceMeters: number;
  readonly cameraHeightMeters: number;
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

  constructor(private readonly camera: PerspectiveCamera, options: AtlasCameraRigOptions = {}) {
    this.fieldOfViewDegrees = options.fieldOfViewDegrees ?? 60;
    this.targetPlayerScreenHeightPercent = options.targetPlayerScreenHeightPercent ?? 0.28;
    this.followDistanceMeters = options.followDistanceMeters ?? 4.75;
    this.cameraHeightMeters = options.cameraHeightMeters ?? 2.62;
    this.shoulderOffsetMeters = options.shoulderOffsetMeters ?? 0.52;
    this.lookAheadMeters = options.lookAheadMeters ?? 4.1;
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
    const escapedCloseWall = this.avoidCloseObstruction(playerPosition, frame.colliders ?? []);

    this.camera.aspect = safeWidth / safeHeight;
    const desiredFov = this.fieldOfViewDegrees + (frame.playerRunning ? 3.5 : frame.playerMoving ? 1.5 : 0);
    const fovBlend = dampingFactor(frame.deltaSeconds, frame.playerRunning ? 4.8 : 3.6);
    this.currentFovDegrees += (desiredFov - this.currentFovDegrees) * fovBlend;
    this.camera.fov = this.currentFovDegrees;
    this.camera.updateProjectionMatrix();

    const targetBlend = dampingFactor(frame.deltaSeconds, 11);
    const positionBlend = dampingFactor(frame.deltaSeconds, 9);
    this.currentTarget.lerp(this.desiredTarget, targetBlend);

    this.cameraPivot.copy(playerPosition);
    this.cameraPivot.y += TARGET_HEIGHT_METERS;
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
  }

  private updateBasis(): void {
    this.forward.set(Math.sin(this.currentHeadingRadians), 0, Math.cos(this.currentHeadingRadians)).normalize();
    this.right.set(-this.forward.z, 0, this.forward.x).normalize();
  }

  private placeDesiredCamera(playerPosition: Vector3): void {
    this.desiredTarget.copy(playerPosition).addScaledVector(this.forward, this.lookAheadMeters);
    this.desiredTarget.y += TARGET_HEIGHT_METERS;
    this.desiredPosition.copy(playerPosition).addScaledVector(this.forward, -this.followDistanceMeters).addScaledVector(this.right, this.shoulderOffsetMeters);
    this.desiredPosition.y += this.cameraHeightMeters;
  }

  private avoidCloseObstruction(playerPosition: Vector3, colliders: readonly AtlasCityCollider[]): boolean {
    if (colliders.length === 0) return false;
    this.cameraPivot.copy(playerPosition);
    this.cameraPivot.y += TARGET_HEIGHT_METERS;
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
