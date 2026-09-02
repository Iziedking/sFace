export type AtlasVec3 = readonly [number, number, number];
export type AtlasQualityTier = 'low' | 'balanced' | 'high';

export type AtlasCityAnchorKind =
  | 'arrival'
  | 'mission'
  | 'conversation'
  | 'work'
  | 'queue'
  | 'pickup'
  | 'install'
  | 'travel';

export type AtlasCityPathPurpose = 'walk' | 'queue' | 'work' | 'conversation' | 'celebration';
export type AtlasCityColliderShape = 'box' | 'capsule' | 'convex';
export type AtlasCityEmitterKind = 'ambient' | 'water' | 'lantern' | 'restoration';

export interface AtlasCityModel {
  readonly id: string;
  readonly url: string;
  readonly contentType: 'model/gltf-binary';
}

export interface AtlasCityInstance {
  readonly id: string;
  readonly modelId: string;
  readonly position: AtlasVec3;
  readonly rotation: AtlasVec3;
  readonly scale: AtlasVec3;
}

export interface AtlasCityAnchor {
  readonly id: string;
  readonly kind: AtlasCityAnchorKind;
  readonly position: AtlasVec3;
  readonly radius: number;
}

export interface AtlasCityPath {
  readonly id: string;
  readonly points: readonly AtlasVec3[];
  readonly purpose: AtlasCityPathPurpose;
  readonly speed: number;
}

export interface AtlasCityCollider {
  readonly id: string;
  readonly shape: AtlasCityColliderShape;
  readonly position: AtlasVec3;
  readonly size: AtlasVec3;
}

export interface AtlasCityEmitter {
  readonly id: string;
  readonly kind: AtlasCityEmitterKind;
  readonly position: AtlasVec3;
  readonly intensity: number;
}

export interface AtlasCityNavigationBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface AtlasCityNavigation {
  readonly safeSpawn: AtlasVec3;
  readonly bounds: AtlasCityNavigationBounds;
  readonly cameraHeadingRadians: number;
}

export interface AtlasCitySceneV1 {
  readonly version: 1;
  readonly districtId: string;
  readonly models: readonly AtlasCityModel[];
  readonly instances: readonly AtlasCityInstance[];
  readonly anchors: readonly AtlasCityAnchor[];
  readonly paths: readonly AtlasCityPath[];
  readonly colliders: readonly AtlasCityCollider[];
  readonly emitters: readonly AtlasCityEmitter[];
  readonly navigation?: AtlasCityNavigation;
}

const ANCHOR_KINDS: readonly AtlasCityAnchorKind[] = [
  'arrival',
  'mission',
  'conversation',
  'work',
  'queue',
  'pickup',
  'install',
  'travel',
];

const PATH_PURPOSES: readonly AtlasCityPathPurpose[] = ['walk', 'queue', 'work', 'conversation', 'celebration'];
const COLLIDER_SHAPES: readonly AtlasCityColliderShape[] = ['box', 'capsule', 'convex'];
const EMITTER_KINDS: readonly AtlasCityEmitterKind[] = ['ambient', 'water', 'lantern', 'restoration'];

export function parseAtlasCityScene(input: unknown): AtlasCitySceneV1 {
  const root = asRecord(input, 'Atlas city scene');
  if (root.version !== 1) throw new Error('Atlas city scene version must be 1.');

  const models = readArray(root.models, 'models').map((value, index) => parseModel(value, index));
  const modelIds = new Set(models.map((model) => model.id));
  const instances = readArray(root.instances, 'instances').map((value, index) => parseInstance(value, index, modelIds));
  const anchors = readArray(root.anchors, 'anchors').map((value, index) => parseAnchor(value, index));
  const paths = readArray(root.paths, 'paths').map((value, index) => parsePath(value, index));
  const colliders = readArray(root.colliders, 'colliders').map((value, index) => parseCollider(value, index));
  const emitters = readArray(root.emitters, 'emitters').map((value, index) => parseEmitter(value, index));
  const navigation = root.navigation === undefined ? undefined : parseNavigation(root.navigation);

  assertUniqueIds(models, 'model');
  assertUniqueIds(instances, 'instance');
  assertUniqueIds(anchors, 'anchor');
  assertUniqueIds(paths, 'path');
  assertUniqueIds(colliders, 'collider');
  assertUniqueIds(emitters, 'emitter');

  return freezeDeep({
    version: 1,
    districtId: requiredString(root.districtId, 'districtId'),
    models,
    instances,
    anchors,
    paths,
    colliders,
    emitters,
    navigation,
  });
}

function parseNavigation(input: unknown): AtlasCityNavigation {
  const record = asRecord(input, 'navigation');
  const boundsRecord = asRecord(record.bounds, 'navigation.bounds');
  const bounds = {
    minX: finiteNumber(boundsRecord.minX, 'navigation.bounds.minX'),
    maxX: finiteNumber(boundsRecord.maxX, 'navigation.bounds.maxX'),
    minZ: finiteNumber(boundsRecord.minZ, 'navigation.bounds.minZ'),
    maxZ: finiteNumber(boundsRecord.maxZ, 'navigation.bounds.maxZ'),
  };
  if (bounds.minX >= bounds.maxX || bounds.minZ >= bounds.maxZ) throw new Error('Atlas city navigation bounds are invalid.');
  const safeSpawn = vector(record.safeSpawn, 'navigation.safeSpawn');
  if (safeSpawn[0] < bounds.minX || safeSpawn[0] > bounds.maxX || safeSpawn[2] < bounds.minZ || safeSpawn[2] > bounds.maxZ) {
    throw new Error('Atlas city navigation safe spawn must be inside its bounds.');
  }
  return {
    safeSpawn,
    bounds,
    cameraHeadingRadians: finiteNumber(record.cameraHeadingRadians ?? Math.PI, 'navigation.cameraHeadingRadians'),
  };
}

function parseModel(input: unknown, index: number): AtlasCityModel {
  const record = asRecord(input, `models[${index}]`);
  const url = requiredString(record.url, `models[${index}].url`);
  if (!url.startsWith('/atlas/') || url.includes('://') || url.split('/').includes('..')) {
    throw new Error(`Runtime asset URL is invalid at models[${index}].url.`);
  }
  if (record.contentType !== 'model/gltf-binary') {
    throw new Error(`models[${index}].contentType must be model/gltf-binary.`);
  }
  return {
    id: requiredString(record.id, `models[${index}].id`),
    url,
    contentType: 'model/gltf-binary',
  };
}

function parseInstance(input: unknown, index: number, modelIds: ReadonlySet<string>): AtlasCityInstance {
  const record = asRecord(input, `instances[${index}]`);
  const modelId = requiredString(record.modelId, `instances[${index}].modelId`);
  if (!modelIds.has(modelId)) throw new Error(`Instances[${index}] references an unknown model.`);
  return {
    id: requiredString(record.id, `instances[${index}].id`),
    modelId,
    position: vector(record.position, `instances[${index}].position`),
    rotation: vector(record.rotation ?? [0, 0, 0], `instances[${index}].rotation`),
    scale: positiveVector(record.scale ?? [1, 1, 1], `instances[${index}].scale`),
  };
}

function parseAnchor(input: unknown, index: number): AtlasCityAnchor {
  const record = asRecord(input, `anchors[${index}]`);
  const kind = enumValue(record.kind, ANCHOR_KINDS, `anchors[${index}].kind`);
  return {
    id: requiredString(record.id, `anchors[${index}].id`),
    kind,
    position: vector(record.position, `anchors[${index}].position`),
    radius: positiveNumber(record.radius ?? 1, `anchors[${index}].radius`),
  };
}

function parsePath(input: unknown, index: number): AtlasCityPath {
  const record = asRecord(input, `paths[${index}]`);
  const points = readArray(record.points, `paths[${index}].points`).map((point, pointIndex) =>
    vector(point, `paths[${index}].points[${pointIndex}]`),
  );
  if (points.length < 2) throw new Error(`Paths[${index}] must contain two points.`);
  return {
    id: requiredString(record.id, `paths[${index}].id`),
    points,
    purpose: enumValue(record.purpose ?? 'walk', PATH_PURPOSES, `paths[${index}].purpose`),
    speed: positiveNumber(record.speed ?? 1, `paths[${index}].speed`),
  };
}

function parseCollider(input: unknown, index: number): AtlasCityCollider {
  const record = asRecord(input, `colliders[${index}]`);
  return {
    id: requiredString(record.id, `colliders[${index}].id`),
    shape: enumValue(record.shape, COLLIDER_SHAPES, `colliders[${index}].shape`),
    position: vector(record.position, `colliders[${index}].position`),
    size: positiveVector(record.size, `colliders[${index}].size`),
  };
}

function parseEmitter(input: unknown, index: number): AtlasCityEmitter {
  const record = asRecord(input, `emitters[${index}]`);
  return {
    id: requiredString(record.id, `emitters[${index}].id`),
    kind: enumValue(record.kind, EMITTER_KINDS, `emitters[${index}].kind`),
    position: vector(record.position, `emitters[${index}].position`),
    intensity: positiveNumber(record.intensity ?? 1, `emitters[${index}].intensity`),
  };
}

function asRecord(input: unknown, label: string): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error(`${label} must be an object.`);
  return input as Record<string, unknown>;
}

function readArray(input: unknown, label: string): unknown[] {
  if (!Array.isArray(input)) throw new Error(`${label} must be an array.`);
  return input;
}

function requiredString(input: unknown, label: string): string {
  if (typeof input !== 'string' || input.trim().length === 0) throw new Error(`${label} must be a non-empty string.`);
  return input;
}

function vector(input: unknown, label: string): AtlasVec3 {
  if (!Array.isArray(input) || input.length !== 3 || input.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
    throw new Error(`${label} must contain three finite numbers.`);
  }
  return [input[0] as number, input[1] as number, input[2] as number];
}

function positiveVector(input: unknown, label: string): AtlasVec3 {
  const result = vector(input, label);
  if (result.some((value) => value <= 0)) throw new Error(`${label} must contain positive numbers.`);
  return result;
}

function positiveNumber(input: unknown, label: string): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input <= 0) throw new Error(`${label} must be a positive finite number.`);
  return input;
}

function finiteNumber(input: unknown, label: string): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) throw new Error(`${label} must be a finite number.`);
  return input;
}

function enumValue<T extends string>(input: unknown, values: readonly T[], label: string): T {
  if (typeof input !== 'string' || !values.includes(input as T)) throw new Error(`${label} is unsupported.`);
  return input as T;
}

function assertUniqueIds<T extends { id: string }>(values: readonly T[], label: string): void {
  const ids = new Set(values.map((value) => value.id));
  if (ids.size !== values.length) throw new Error(`Duplicate ${label} id.`);
}

function freezeDeep<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
  return Object.freeze(value);
}
