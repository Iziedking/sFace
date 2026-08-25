import type { AtlasManifestKind, AtlasPublishedManifest } from './types';

const CURRENT_MANIFEST_VERSIONS: Record<AtlasManifestKind, number> = {
  campaign: 2,
  adventure: 1,
  knowledge: 1,
  season: 1,
  shop: 1,
};

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export async function sha256Hex(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function createPublishedManifest<T>(
  kind: AtlasManifestKind,
  version: number,
  reviewedAt: string,
  content: T,
  supersedes?: string,
): Promise<AtlasPublishedManifest<T>> {
  return { kind, version, contentHash: await sha256Hex(content), reviewedAt, ...(supersedes ? { supersedes } : {}), content };
}

export function validatePublishedManifest<T>(value: unknown): AtlasPublishedManifest<T> {
  if (!isRecord(value) || !isManifestKind(value.kind)) {
    throw new Error('Published Atlas manifest is malformed.');
  }
  if (typeof value.version !== 'number' || !Number.isInteger(value.version) || value.version < 1 || typeof value.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.contentHash) || typeof value.reviewedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.reviewedAt) || !('content' in value)) {
    throw new Error('Published Atlas manifest is malformed.');
  }
  const kind = value.kind;
  const version = value.version;
  if (version > CURRENT_MANIFEST_VERSIONS[kind]) throw new Error(`Unknown Atlas manifest version: ${kind} v${String(version)}.`);
  if ('supersedes' in value && value.supersedes !== undefined && (typeof value.supersedes !== 'string' || !/^[a-f0-9]{64}$/.test(value.supersedes))) {
    throw new Error('Manifest supersedes hash is invalid.');
  }
  assertUniqueContentIds(value.content);
  assertShopSafety(value.kind, value.content);
  return value as unknown as AtlasPublishedManifest<T>;
}

export async function verifyPublishedManifest<T>(value: unknown, now: Date): Promise<AtlasPublishedManifest<T>> {
  const manifest = validatePublishedManifest<T>(value);
  const reviewed = new Date(`${manifest.reviewedAt}T00:00:00.000Z`);
  const ageDays = (now.getTime() - reviewed.getTime()) / 86_400_000;
  if (!Number.isFinite(ageDays) || ageDays < 0 || ageDays > 120) throw new Error('Atlas manifest source is stale.');
  if (await sha256Hex(manifest.content) !== manifest.contentHash) throw new Error('Atlas manifest content hash drift detected.');
  return manifest;
}

export function assertManifestSupersedes<T>(previous: AtlasPublishedManifest<T>, next: AtlasPublishedManifest<T>): void {
  if (previous.kind !== next.kind) throw new Error('Only manifests of the same kind can supersede each other.');
  if (next.version <= previous.version) throw new Error('Published manifest versions are immutable and corrections require a superseding version.');
  if (next.supersedes !== previous.contentHash) throw new Error('Correction must supersede the exact previous content hash.');
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isManifestKind(value: unknown): value is AtlasManifestKind {
  return value === 'campaign' || value === 'adventure' || value === 'knowledge' || value === 'season' || value === 'shop';
}

function assertUniqueContentIds(value: unknown): void {
  if (!isRecord(value)) return;
  for (const key of ['districts', 'adventures', 'fragments', 'items', 'challenges', 'pages']) {
    const list = value[key];
    if (!Array.isArray(list)) continue;
    const ids = list.map((item) => isRecord(item) ? item.id : undefined).filter((id): id is string => typeof id === 'string');
    if (new Set(ids).size !== ids.length) throw new Error(`Duplicate Atlas content ID in ${key}.`);
  }
}

function assertShopSafety(kind: AtlasManifestKind, value: unknown): void {
  if (kind !== 'shop' || !isRecord(value) || !Array.isArray(value.items)) return;
  for (const item of value.items) {
    if (!isRecord(item)) throw new Error('Shop item is malformed.');
    if (item.network === 'mainalbatross' && (item.enabled === true || item.ownerGate !== true)) {
      throw new Error('Mainnet shop items must remain disabled behind an owner gate.');
    }
  }
}
