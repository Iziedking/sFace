import type { AtlasQualityTier } from '../../../shared/atlas/city/types';

export const ATLAS_ASSET_MANIFEST_VERSION = 1;
export const ATLAS_MOBILE_ASSET_BUDGET_BYTES = 262_144;

export type AtlasAssetMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml' | 'audio/mpeg' | 'audio/ogg' | 'font/woff2' | 'application/json' | 'model/gltf-binary';
export type AtlasAssetSourceStatus = 'owner-approved-procedural';

export interface AtlasAssetManifestEntry {
  id: string;
  path: string;
  sha256: string;
  bytes: number;
  compressedBytes: number;
  mime: AtlasAssetMime;
  width: number;
  height: number;
  bundle: string;
  quality?: readonly AtlasQualityTier[];
  sourceFile?: string;
  sourceSha256?: string;
  sourceStatus?: AtlasAssetSourceStatus;
}

export interface AtlasAssetManifest {
  version: number;
  mobileBudgetBytes: number;
  assets: AtlasAssetManifestEntry[];
}

export interface AtlasAssetManifestV2Entry extends AtlasAssetManifestEntry {
  quality?: readonly AtlasQualityTier[];
  sourceFile?: string;
  sourceSha256?: string;
  sourceStatus?: AtlasAssetSourceStatus;
}

export interface AtlasAssetManifestV2 {
  version: 2;
  mobileBudgetBytes: number;
  assets: AtlasAssetManifestV2Entry[];
}

export type ParsedAtlasAssetManifest = AtlasAssetManifest | AtlasAssetManifestV2;

export function parseAtlasAssetManifest(input: unknown): ParsedAtlasAssetManifest {
  if (!isRecord(input)) throw new Error('Atlas asset manifest must be an object.');
  const version = input.version;
  if (version !== 1 && version !== 2) throw new Error('Atlas asset manifest version is unsupported.');
  const mobileBudgetBytes = positiveInteger(input.mobileBudgetBytes, 'mobileBudgetBytes');
  if (!Array.isArray(input.assets)) throw new Error('Atlas asset manifest assets must be an array.');
  const ids = new Set<string>();
  const assets = input.assets.map((entry, index) => {
    const parsed = parseManifestEntry(entry, index, version);
    if (ids.has(parsed.id)) throw new Error(`Duplicate asset id: ${parsed.id}.`);
    ids.add(parsed.id);
    return parsed;
  });
  if (version === 2) {
    return { version: 2, mobileBudgetBytes, assets };
  }
  return { version: 1, mobileBudgetBytes, assets };
}

function parseManifestEntry(input: unknown, index: number, version: 1 | 2): AtlasAssetManifestV2Entry {
  if (!isRecord(input)) throw new Error(`Atlas asset entry ${index} must be an object.`);
  const mime = enumValue(input.mime, ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'audio/mpeg', 'audio/ogg', 'font/woff2', 'application/json', 'model/gltf-binary'] as const, `assets[${index}].mime`);
  const path = requiredString(input.path, `assets[${index}].path`);
  if (!path.startsWith('/') || path.includes('://') || path.split('/').includes('..')) throw new Error(`Atlas asset path is invalid at assets[${index}].path.`);
  const entry: AtlasAssetManifestEntry = {
    id: requiredString(input.id, `assets[${index}].id`),
    path,
    sha256: hash(input.sha256, `assets[${index}].sha256`),
    bytes: positiveInteger(input.bytes, `assets[${index}].bytes`),
    compressedBytes: positiveInteger(input.compressedBytes, `assets[${index}].compressedBytes`),
    mime,
    width: positiveInteger(input.width, `assets[${index}].width`),
    height: positiveInteger(input.height, `assets[${index}].height`),
    bundle: requiredString(input.bundle, `assets[${index}].bundle`),
  };
  if (version === 1 || mime !== 'model/gltf-binary') return entry;
  const quality = parseQuality(input.quality, index);
  const sourceFile = requiredString(input.sourceFile, `assets[${index}].sourceFile`);
  if (sourceFile.startsWith('/') || sourceFile.includes('://') || sourceFile.split('/').includes('..')) throw new Error(`Procedural source file is invalid at assets[${index}].sourceFile.`);
  if (input.sourceStatus !== 'owner-approved-procedural') throw new Error(`3D assets require procedural provenance at assets[${index}].sourceStatus.`);
  return {
    ...entry,
    quality,
    sourceFile,
    sourceSha256: hash(input.sourceSha256, `assets[${index}].sourceSha256`),
    sourceStatus: 'owner-approved-procedural',
  };
}

function parseQuality(input: unknown, index: number): readonly AtlasQualityTier[] {
  if (!Array.isArray(input) || input.length === 0) throw new Error(`3D assets require procedural provenance quality at assets[${index}].quality.`);
  const values = input.map((value) => enumValue(value, ['low', 'balanced', 'high'] as const, `assets[${index}].quality`));
  return [...new Set(values)];
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function requiredString(input: unknown, label: string): string {
  if (typeof input !== 'string' || input.trim().length === 0) throw new Error(`${label} must be a non-empty string.`);
  return input;
}

function positiveInteger(input: unknown, label: string): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input <= 0) throw new Error(`${label} must be a positive integer.`);
  return input;
}

function hash(input: unknown, label: string): string {
  if (typeof input !== 'string' || !/^[a-f0-9]{64}$/i.test(input)) throw new Error(`${label} must be a SHA-256 hex string.`);
  return input;
}

function enumValue<T extends string>(input: unknown, values: readonly T[], label: string): T {
  if (typeof input !== 'string' || !values.includes(input as T)) throw new Error(`${label} is unsupported.`);
  return input as T;
}
