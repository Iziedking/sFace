import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export interface LegacyManifest {
  sourcePath: string;
  snapshotVersion: number;
  byteLength: number;
  sha256: string;
  recordCounts: Record<string, number>;
}

function countCollection(value: unknown): number | null {
  return Array.isArray(value) ? value.length : null;
}

function recordCounts(snapshot: Record<string, unknown>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [key, value] of Object.entries(snapshot)) {
    const directCount = countCollection(value);
    if (directCount !== null) {
      counts[key] = directCount;
      continue;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    for (const [nestedKey, nestedValue] of Object.entries(value)) {
      const nestedCount = countCollection(nestedValue);
      if (nestedCount !== null) counts[`${key}.${nestedKey}`] = nestedCount;
    }
    if (key === 'mission') counts[key] = 1;
  }
  return counts;
}

export async function buildLegacyManifest(sourcePath: string): Promise<LegacyManifest> {
  const absoluteSourcePath = resolve(sourcePath);
  const bytes = await readFile(absoluteSourcePath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('Legacy snapshot is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Legacy snapshot must be a JSON object.');
  }
  const snapshot = parsed as Record<string, unknown>;
  if (typeof snapshot.version !== 'number' || !Number.isInteger(snapshot.version)) {
    throw new Error('Legacy snapshot version is missing or invalid.');
  }
  return {
    sourcePath: absoluteSourcePath,
    snapshotVersion: snapshot.version,
    byteLength: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    recordCounts: recordCounts(snapshot),
  };
}

export function resolveLegacyArchivePath(dataDirectory: string, targetPath: string): string {
  const dataRoot = resolve(dataDirectory);
  const archiveRoot = resolve(dataRoot, 'legacy-archive');
  const target = resolve(targetPath);
  const relativeTarget = relative(archiveRoot, target);
  if (
    relativeTarget === '..' ||
    relativeTarget.startsWith(`..${sep}`) ||
    isAbsolute(relativeTarget)
  ) {
    throw new Error('Legacy archive paths must remain under DATA_DIR/legacy-archive.');
  }
  return target;
}
