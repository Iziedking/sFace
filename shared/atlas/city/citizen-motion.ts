import type { AtlasCitizenActivity } from './crowd';
import type { AtlasCityPace } from './player';
import type { AtlasCityCollider, AtlasCityPath, AtlasVec3 } from './types';

export interface AtlasCitizenMotionInput {
  readonly active: boolean;
  readonly activity: AtlasCitizenActivity;
  readonly elapsedSeconds: number;
  readonly phase: number;
  readonly path: AtlasCityPath;
  readonly spawn: AtlasVec3;
}

export interface AtlasCitizenMotionProjection {
  readonly position: AtlasVec3;
  readonly headingRadians: number;
  readonly moving: boolean;
  readonly pace: AtlasCityPace;
  readonly speedUnitsPerSecond: number;
}

export interface AtlasCitizenSpacingInput {
  readonly id: string;
  readonly motion: AtlasCitizenMotionProjection;
  readonly previousPosition?: AtlasCitizenAvoidancePoint;
}

export interface AtlasCitizenAvoidancePoint {
  readonly x: number;
  readonly z: number;
}

const WALK_SPEED_SCALE = 0.44;
const RUN_SPEED_SCALE = 0.98;
const MINIMUM_WALK_SPEED = 0.28;
const MAXIMUM_WALK_SPEED = 0.9;
const MINIMUM_RUN_SPEED = 1.45;
const MAXIMUM_RUN_SPEED = 2.05;
const CITIZEN_PERSONAL_SPACE_METERS = 0.52;
const PLAYER_PERSONAL_SPACE_METERS = 0.485;
const SPACING_ITERATIONS = 5;
const CITIZEN_COLLISION_RADIUS_METERS = 0.24;
const COLLISION_SUBSTEP_METERS = 0.1;

export function projectAtlasCitizenMotion(input: AtlasCitizenMotionInput): AtlasCitizenMotionProjection {
  const desiredPace = paceForActivity(input.activity);
  const pathLength = polylineLength(input.path.points);
  if (!input.active || desiredPace === 'idle' || input.path.points.length < 2 || pathLength <= 0.0001) {
    return stationaryProjection(input.spawn, stationaryHeading(input.activity, input.phase));
  }

  const phase = positiveModulo(finiteOr(input.phase, 0), 1);
  const elapsedSeconds = Math.max(0, finiteOr(input.elapsedSeconds, 0));
  const speed = motionSpeed(input.path.speed, desiredPace);
  const travelSeconds = pathLength / speed;
  const dwellSeconds = dwellDuration(input.path.purpose, phase);
  const cycleSeconds = travelSeconds * 2 + dwellSeconds * 2;
  const cycleTime = positiveModulo(elapsedSeconds + phase * cycleSeconds, cycleSeconds);

  let distanceAlongPath: number;
  let moving: boolean;
  let forward: boolean;
  if (cycleTime < travelSeconds) {
    distanceAlongPath = cycleTime * speed;
    moving = true;
    forward = true;
  } else if (cycleTime < travelSeconds + dwellSeconds) {
    distanceAlongPath = pathLength;
    moving = false;
    forward = true;
  } else if (cycleTime < travelSeconds * 2 + dwellSeconds) {
    distanceAlongPath = pathLength - (cycleTime - travelSeconds - dwellSeconds) * speed;
    moving = true;
    forward = false;
  } else {
    distanceAlongPath = 0;
    moving = false;
    forward = false;
  }

  const pathSample = samplePolyline(input.path.points, distanceAlongPath, forward);
  return {
    position: pathSample.position,
    headingRadians: pathSample.headingRadians,
    moving,
    pace: moving ? desiredPace : 'idle',
    speedUnitsPerSecond: moving ? speed : 0,
  };
}

export function resolveAtlasCitizenSpacing(
  citizens: readonly AtlasCitizenSpacingInput[],
  player?: AtlasCitizenAvoidancePoint,
  colliders: readonly AtlasCityCollider[] = [],
): readonly AtlasCitizenMotionProjection[] {
  const positions = citizens.map(({ motion, previousPosition }) => {
    const desired = { x: motion.position[0], z: motion.position[2] };
    return moveCitizenOutsideColliders(previousPosition ?? desired, desired, colliders);
  });
  for (let iteration = 0; iteration < SPACING_ITERATIONS; iteration += 1) {
    for (let leftIndex = 0; leftIndex < citizens.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < citizens.length; rightIndex += 1) {
        separatePair(
          positions[leftIndex]!,
          positions[rightIndex]!,
          citizens[leftIndex]!.id,
          citizens[rightIndex]!.id,
          CITIZEN_PERSONAL_SPACE_METERS,
        );
      }
    }
    if (player) {
      for (let index = 0; index < citizens.length; index += 1) {
        separateFromPoint(positions[index]!, player, citizens[index]!.id, PLAYER_PERSONAL_SPACE_METERS);
      }
    }
    for (let index = 0; index < positions.length; index += 1) {
      positions[index] = projectCitizenOutsideColliders(positions[index]!, colliders);
    }
  }
  return citizens.map(({ motion, previousPosition }, index) => {
    const position = positions[index]!;
    const deltaX = previousPosition ? position.x - previousPosition.x : 0;
    const deltaZ = previousPosition ? position.z - previousPosition.z : 0;
    return {
      ...motion,
      position: [position.x, motion.position[1], position.z],
      headingRadians: motion.moving && Math.hypot(deltaX, deltaZ) > 0.0001 ? Math.atan2(deltaX, deltaZ) : motion.headingRadians,
    };
  });
}

export function isAtlasCitizenPositionBlocked(
  point: AtlasCitizenAvoidancePoint,
  colliders: readonly AtlasCityCollider[],
): boolean {
  return colliders.some((collider) => citizenIntersectsCollider(point, collider));
}

/**
 * Routes an authored crowd path around city colliders with a small, cached
 * visibility graph. This keeps the scene format lightweight while preventing
 * citizens from being authored directly through buildings.
 */
export function routeAtlasCitizenPath(path: AtlasCityPath, colliders: readonly AtlasCityCollider[]): AtlasCityPath {
  if (path.points.length < 2 || colliders.length === 0) return path;
  const routed: AtlasVec3[] = [path.points[0]!];
  for (let index = 1; index < path.points.length; index += 1) {
    const from = routed[routed.length - 1]!;
    const to = path.points[index]!;
    for (const point of shortestSafeSegment(from, to, colliders).slice(1)) appendPathPoint(routed, point);
  }
  return { ...path, points: routed };
}

function shortestSafeSegment(
  from: AtlasVec3,
  to: AtlasVec3,
  colliders: readonly AtlasCityCollider[],
): readonly AtlasVec3[] {
  if (safeSegment({ x: from[0], z: from[2] }, { x: to[0], z: to[2] }, colliders)) return [from, to];

  const nodes: AtlasCitizenAvoidancePoint[] = [
    { x: from[0], z: from[2] },
    { x: to[0], z: to[2] },
    ...colliders.flatMap((collider) => avoidanceCorners(collider)),
  ];
  const distances = nodes.map(() => Number.POSITIVE_INFINITY);
  const previous = nodes.map(() => -1);
  const visited = nodes.map(() => false);
  distances[0] = 0;

  for (let iteration = 0; iteration < nodes.length; iteration += 1) {
    let current = -1;
    let best = Number.POSITIVE_INFINITY;
    for (let index = 0; index < nodes.length; index += 1) {
      if (!visited[index] && distances[index]! < best) {
        best = distances[index]!;
        current = index;
      }
    }
    if (current < 0) break;
    visited[current] = true;
    if (current === 1) break;
    for (let next = 0; next < nodes.length; next += 1) {
      if (visited[next] || next === current || !safeSegment(nodes[current]!, nodes[next]!, colliders)) continue;
      const candidate = distances[current]! + distance2d(nodes[current]!, nodes[next]!);
      if (candidate < distances[next]!) {
        distances[next] = candidate;
        previous[next] = current;
      }
    }
  }

  if (!Number.isFinite(distances[1])) return [from, to];
  const indices: number[] = [];
  for (let current = 1; current >= 0; current = previous[current]!) {
    indices.push(current);
    if (current === 0) break;
  }
  indices.reverse();
  const directDistance = distance2d(nodes[0]!, nodes[1]!);
  return indices.map((index) => {
    const point = nodes[index]!;
    const amount = directDistance <= 0.0001 ? 0 : clamp(distance2d(nodes[0]!, point) / directDistance, 0, 1);
    return [point.x, from[1] + (to[1] - from[1]) * amount, point.z] as AtlasVec3;
  });
}

function avoidanceCorners(collider: AtlasCityCollider): readonly AtlasCitizenAvoidancePoint[] {
  const padding = CITIZEN_COLLISION_RADIUS_METERS + 0.18;
  if (collider.shape === 'capsule') {
    const radius = Math.max(collider.size[0], collider.size[2]) / 2 + padding;
    return Array.from({ length: 8 }, (_, index) => {
      const angle = index * Math.PI / 4;
      return { x: collider.position[0] + Math.sin(angle) * radius, z: collider.position[2] + Math.cos(angle) * radius };
    });
  }
  const halfX = collider.size[0] / 2 + padding;
  const halfZ = collider.size[2] / 2 + padding;
  return [
    { x: collider.position[0] - halfX, z: collider.position[2] - halfZ },
    { x: collider.position[0] + halfX, z: collider.position[2] - halfZ },
    { x: collider.position[0] + halfX, z: collider.position[2] + halfZ },
    { x: collider.position[0] - halfX, z: collider.position[2] + halfZ },
  ];
}

function safeSegment(from: AtlasCitizenAvoidancePoint, to: AtlasCitizenAvoidancePoint, colliders: readonly AtlasCityCollider[]): boolean {
  const distance = distance2d(from, to);
  const steps = Math.max(1, Math.ceil(distance / (COLLISION_SUBSTEP_METERS * 0.8)));
  for (let index = 0; index <= steps; index += 1) {
    const amount = index / steps;
    if (isAtlasCitizenPositionBlocked({ x: from.x + (to.x - from.x) * amount, z: from.z + (to.z - from.z) * amount }, colliders)) return false;
  }
  return true;
}

function appendPathPoint(path: AtlasVec3[], point: AtlasVec3): void {
  const previous = path[path.length - 1];
  if (!previous || Math.hypot(point[0] - previous[0], point[2] - previous[2]) > 0.03) path.push(point);
}

function distance2d(left: AtlasCitizenAvoidancePoint, right: AtlasCitizenAvoidancePoint): number {
  return Math.hypot(right.x - left.x, right.z - left.z);
}

function moveCitizenOutsideColliders(
  previous: AtlasCitizenAvoidancePoint,
  desired: AtlasCitizenAvoidancePoint,
  colliders: readonly AtlasCityCollider[],
): { x: number; z: number } {
  let position = projectCitizenOutsideColliders(previous, colliders);
  const deltaX = desired.x - position.x;
  const deltaZ = desired.z - position.z;
  const substeps = Math.max(1, Math.ceil(Math.hypot(deltaX, deltaZ) / COLLISION_SUBSTEP_METERS));
  const stepX = deltaX / substeps;
  const stepZ = deltaZ / substeps;
  for (let index = 0; index < substeps; index += 1) {
    const candidateX = { x: position.x + stepX, z: position.z };
    if (!isAtlasCitizenPositionBlocked(candidateX, colliders)) position = candidateX;
    const candidateZ = { x: position.x, z: position.z + stepZ };
    if (!isAtlasCitizenPositionBlocked(candidateZ, colliders)) position = candidateZ;
  }
  return projectCitizenOutsideColliders(position, colliders);
}

function projectCitizenOutsideColliders(
  point: AtlasCitizenAvoidancePoint,
  colliders: readonly AtlasCityCollider[],
): { x: number; z: number } {
  let position = { x: finiteOr(point.x, 0), z: finiteOr(point.z, 0) };
  const maximumPasses = Math.min(8, colliders.length + 1);
  for (let pass = 0; pass < maximumPasses; pass += 1) {
    let corrected = false;
    for (const collider of colliders) {
      if (!citizenIntersectsCollider(position, collider)) continue;
      position = nearestPointOutsideCollider(position, collider);
      corrected = true;
    }
    if (!corrected) break;
  }
  return position;
}

function citizenIntersectsCollider(point: AtlasCitizenAvoidancePoint, collider: AtlasCityCollider): boolean {
  if (collider.shape === 'box' || collider.shape === 'convex') {
    const halfX = collider.size[0] / 2 + CITIZEN_COLLISION_RADIUS_METERS;
    const halfZ = collider.size[2] / 2 + CITIZEN_COLLISION_RADIUS_METERS;
    return Math.abs(point.x - collider.position[0]) < halfX && Math.abs(point.z - collider.position[2]) < halfZ;
  }
  const radius = Math.max(collider.size[0], collider.size[2]) / 2 + CITIZEN_COLLISION_RADIUS_METERS;
  return Math.hypot(point.x - collider.position[0], point.z - collider.position[2]) < radius;
}

function nearestPointOutsideCollider(
  point: AtlasCitizenAvoidancePoint,
  collider: AtlasCityCollider,
): { x: number; z: number } {
  if (collider.shape === 'capsule') {
    const radius = Math.max(collider.size[0], collider.size[2]) / 2 + CITIZEN_COLLISION_RADIUS_METERS;
    const deltaX = point.x - collider.position[0];
    const deltaZ = point.z - collider.position[2];
    const distance = Math.hypot(deltaX, deltaZ);
    if (distance > 0.000001) {
      return {
        x: collider.position[0] + deltaX / distance * radius,
        z: collider.position[2] + deltaZ / distance * radius,
      };
    }
    const angle = stableAvoidanceAngle(collider.id);
    return {
      x: collider.position[0] + Math.sin(angle) * radius,
      z: collider.position[2] + Math.cos(angle) * radius,
    };
  }

  const halfX = collider.size[0] / 2 + CITIZEN_COLLISION_RADIUS_METERS;
  const halfZ = collider.size[2] / 2 + CITIZEN_COLLISION_RADIUS_METERS;
  const minimumX = collider.position[0] - halfX;
  const maximumX = collider.position[0] + halfX;
  const minimumZ = collider.position[2] - halfZ;
  const maximumZ = collider.position[2] + halfZ;
  const exits = [
    { distance: point.x - minimumX, x: minimumX, z: point.z },
    { distance: maximumX - point.x, x: maximumX, z: point.z },
    { distance: point.z - minimumZ, x: point.x, z: minimumZ },
    { distance: maximumZ - point.z, x: point.x, z: maximumZ },
  ];
  exits.sort((left, right) => left.distance - right.distance);
  return { x: exits[0]!.x, z: exits[0]!.z };
}

function separatePair(
  left: { x: number; z: number },
  right: { x: number; z: number },
  leftId: string,
  rightId: string,
  minimumDistance: number,
): void {
  let deltaX = right.x - left.x;
  let deltaZ = right.z - left.z;
  const distance = Math.hypot(deltaX, deltaZ);
  if (distance >= minimumDistance) return;
  let normalX: number;
  let normalZ: number;
  if (distance <= 0.000001) {
    const angle = stableAvoidanceAngle(`${leftId}:${rightId}`);
    normalX = Math.sin(angle);
    normalZ = Math.cos(angle);
  } else {
    normalX = deltaX / distance;
    normalZ = deltaZ / distance;
  }
  const correction = (minimumDistance - distance) * 0.5;
  left.x -= normalX * correction;
  left.z -= normalZ * correction;
  right.x += normalX * correction;
  right.z += normalZ * correction;
}

function separateFromPoint(
  citizen: { x: number; z: number },
  point: AtlasCitizenAvoidancePoint,
  citizenId: string,
  minimumDistance: number,
): void {
  let deltaX = citizen.x - point.x;
  let deltaZ = citizen.z - point.z;
  const distance = Math.hypot(deltaX, deltaZ);
  if (distance >= minimumDistance) return;
  let normalX: number;
  let normalZ: number;
  if (distance <= 0.000001) {
    const angle = stableAvoidanceAngle(citizenId);
    normalX = Math.sin(angle);
    normalZ = Math.cos(angle);
  } else {
    normalX = deltaX / distance;
    normalZ = deltaZ / distance;
  }
  const correction = minimumDistance - distance;
  citizen.x += normalX * correction;
  citizen.z += normalZ * correction;
}

function stableAvoidanceAngle(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return ((hash >>> 0) % 360) * Math.PI / 180;
}

function paceForActivity(activity: AtlasCitizenActivity): AtlasCityPace {
  if (activity === 'jogging') return 'run';
  if (activity === 'walking' || activity === 'carrying') return 'walk';
  return 'idle';
}

function motionSpeed(authoredSpeed: number, pace: Exclude<AtlasCityPace, 'idle'>): number {
  const speed = Math.max(0.01, finiteOr(authoredSpeed, 1));
  if (pace === 'run') return clamp(speed * RUN_SPEED_SCALE, MINIMUM_RUN_SPEED, MAXIMUM_RUN_SPEED);
  return clamp(speed * WALK_SPEED_SCALE, MINIMUM_WALK_SPEED, MAXIMUM_WALK_SPEED);
}

function dwellDuration(purpose: AtlasCityPath['purpose'], phase: number): number {
  if (purpose === 'queue') return 5.5 + phase * 2;
  if (purpose === 'work' || purpose === 'conversation') return 6.5 + phase * 2.5;
  if (purpose === 'celebration') return 2.5 + phase;
  return 3.4 + phase * 2.6;
}

function samplePolyline(points: readonly AtlasVec3[], requestedDistance: number, forward: boolean): { position: AtlasVec3; headingRadians: number } {
  const totalLength = polylineLength(points);
  let remaining = clamp(requestedDistance, 0, totalLength);
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1]!;
    const to = points[index]!;
    const segmentLength = distanceBetween(from, to);
    if (remaining <= segmentLength || index === points.length - 1) {
      const amount = segmentLength <= 0.0001 ? 0 : clamp(remaining / segmentLength, 0, 1);
      const direction = forward ? 1 : -1;
      return {
        position: [
          from[0] + (to[0] - from[0]) * amount,
          from[1] + (to[1] - from[1]) * amount,
          from[2] + (to[2] - from[2]) * amount,
        ],
        headingRadians: Math.atan2((to[0] - from[0]) * direction, (to[2] - from[2]) * direction),
      };
    }
    remaining -= segmentLength;
  }
  return { position: points[points.length - 1] ?? [0, 0, 0], headingRadians: 0 };
}

function stationaryProjection(position: AtlasVec3, headingRadians: number): AtlasCitizenMotionProjection {
  return { position, headingRadians, moving: false, pace: 'idle', speedUnitsPerSecond: 0 };
}

function stationaryHeading(activity: AtlasCitizenActivity, phase: number): number {
  const base = positiveModulo(finiteOr(phase, 0), 1) * Math.PI * 2;
  if (activity === 'talking' || activity === 'trading') return base * 0.32 - 0.5;
  if (activity === 'repairing' || activity === 'planning') return base * 0.2 - 0.35;
  return base;
}

function polylineLength(points: readonly AtlasVec3[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) total += distanceBetween(points[index - 1]!, points[index]!);
  return total;
}

function distanceBetween(left: AtlasVec3, right: AtlasVec3): number {
  return Math.hypot(right[0] - left[0], right[1] - left[1], right[2] - left[2]);
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
