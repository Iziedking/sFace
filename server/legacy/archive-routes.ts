import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Express, RequestHandler } from 'express';

import {
  ADMIN_RECORD_PAGE_SIZE_MAX,
  ADMIN_RECORD_RESPONSE_LIMIT_BYTES,
  adminRecord,
  paginateAdminRecords,
  type AdminRecordSources,
} from '../admin/records';
import { buildLegacyManifest, type LegacyManifest } from './manifest';

interface ArchivedManifest extends LegacyManifest {
  lastVerifiedAt?: number | null;
}

interface LegacyArchiveError extends Error {
  code: 'legacy_archive_corrupt' | 'legacy_snapshot_checksum_mismatch' | 'legacy_archive_unavailable';
}

export interface LegacyArchiveOverview extends LegacyManifest {
  backupCount: number;
  lastVerifiedAt: number | null;
}

export interface LegacyArchiveReaderDeps {
  dataDirectory: string;
  sources?: AdminRecordSources;
  responseLimitBytes?: number;
}

export interface LegacyArchiveReader {
  manifest(): Promise<LegacyArchiveOverview>;
  records(kind: string, page: number, pageSize: number): Promise<ReturnType<typeof paginateAdminRecords>>;
}

function archiveError(code: LegacyArchiveError['code'], message: string): LegacyArchiveError {
  const error = new Error(message) as LegacyArchiveError;
  error.code = code;
  return error;
}

function isManifest(value: unknown): value is ArchivedManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const manifest = value as Partial<ArchivedManifest>;
  return typeof manifest.sourcePath === 'string'
    && Number.isInteger(manifest.snapshotVersion)
    && typeof manifest.byteLength === 'number'
    && Number.isInteger(manifest.byteLength)
    && manifest.byteLength >= 0
    && typeof manifest.sha256 === 'string'
    && /^[0-9a-f]{64}$/i.test(manifest.sha256)
    && !!manifest.recordCounts
    && typeof manifest.recordCounts === 'object'
    && (manifest.lastVerifiedAt === undefined || manifest.lastVerifiedAt === null || typeof manifest.lastVerifiedAt === 'number');
}

async function readJson(path: string): Promise<unknown> {
  const raw = await readFile(path, 'utf8');
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw archiveError('legacy_archive_corrupt', 'The legacy archive is corrupt.');
  }
}

async function backupNames(archiveDirectory: string): Promise<string[]> {
  try {
    const entries = await readdir(archiveDirectory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && /^sface\.json\..+\.bak$/.test(entry.name))
      .map((entry) => entry.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw archiveError('legacy_archive_unavailable', 'The legacy archive is unavailable.');
  }
}

export function createLegacyArchiveReader(deps: LegacyArchiveReaderDeps): LegacyArchiveReader {
  const dataDirectory = resolve(deps.dataDirectory);
  const sourcePath = join(dataDirectory, 'sface.json');
  const archiveDirectory = join(dataDirectory, 'legacy-archive');
  const responseLimitBytes = deps.responseLimitBytes ?? ADMIN_RECORD_RESPONSE_LIMIT_BYTES;

  async function manifest(): Promise<LegacyArchiveOverview> {
    const current = await buildLegacyManifest(sourcePath).catch(() => {
      throw archiveError('legacy_archive_corrupt', 'The legacy snapshot is corrupt.');
    });
    const names = await backupNames(archiveDirectory);
    let lastVerifiedAt: number | null = null;
    let expectedSha256 = current.sha256;
    const manifestPath = join(archiveDirectory, 'manifest.json');
    try {
      const archived = await readJson(manifestPath);
      if (!isManifest(archived)) throw archiveError('legacy_archive_corrupt', 'The legacy manifest is corrupt.');
      if (archived.sha256.toLowerCase() !== current.sha256 || archived.byteLength !== current.byteLength || archived.snapshotVersion !== current.snapshotVersion) {
        throw archiveError('legacy_snapshot_checksum_mismatch', 'The legacy snapshot checksum does not match its manifest.');
      }
      expectedSha256 = archived.sha256.toLowerCase();
      lastVerifiedAt = archived.lastVerifiedAt ?? null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    for (const name of names) {
      const bytes = await readFile(join(archiveDirectory, name)).catch(() => {
        throw archiveError('legacy_archive_unavailable', 'The legacy archive backup is unavailable.');
      });
      const checksum = createHash('sha256').update(bytes).digest('hex');
      if (checksum !== expectedSha256) throw archiveError('legacy_snapshot_checksum_mismatch', 'A legacy archive backup checksum does not match.');
    }

    return { ...current, backupCount: names.length, lastVerifiedAt };
  }

  async function records(kind: string, page: number, pageSize: number): Promise<ReturnType<typeof paginateAdminRecords>> {
    const result = adminRecord(kind, deps.sources ?? {});
    if (!result.ok && result.error === 'unknown_record_kind') return { ok: false, error: result.error };
    await manifest();
    const snapshot = await readJson(sourcePath);
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      throw archiveError('legacy_archive_corrupt', 'The legacy snapshot is corrupt.');
    }
    const snapshotRecords = Object.prototype.hasOwnProperty.call(snapshot, kind)
      ? (snapshot as Record<string, unknown>)[kind]
      : result.ok ? result.records : undefined;
    return paginateAdminRecords(kind, snapshotRecords, page, pageSize, responseLimitBytes);
  }

  return { manifest, records };
}

export interface LegacyArchiveRoutesDeps extends LegacyArchiveReaderDeps {
  app: Express;
  limit: (perMinute: number, burst: number) => RequestHandler;
  requireAdmin: RequestHandler;
  adminReadsEnabled: boolean;
  record: (entry: { time: number; level: 'info' | 'warn' | 'error'; subsystem: string; event: string; message: string; context?: Record<string, unknown> }) => void;
}

function publicArchiveError(error: unknown): { status: number; body: { error: string } } {
  const code = (error as Partial<LegacyArchiveError>).code;
  if (code === 'legacy_snapshot_checksum_mismatch') return { status: 503, body: { error: 'legacy_snapshot_checksum_mismatch' } };
  if (code === 'legacy_archive_corrupt') return { status: 503, body: { error: 'legacy_archive_corrupt' } };
  return { status: 503, body: { error: 'legacy_archive_unavailable' } };
}

function queryInteger(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (Array.isArray(value) || typeof value !== 'string' || !/^\d+$/.test(value)) return Number.NaN;
  return Number(value);
}

export function mountLegacyArchiveRoutes(deps: LegacyArchiveRoutesDeps): void {
  const reader = createLegacyArchiveReader(deps);
  const { app, limit, requireAdmin } = deps;
  const guard = (_req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1], next: Parameters<RequestHandler>[2]): void => {
    if (!deps.adminReadsEnabled) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    next();
  };

  app.get('/admin/api/legacy/manifest', limit(30, 10), requireAdmin, guard, async (_req, res) => {
    try {
      res.setHeader('cache-control', 'no-store');
      res.json(await reader.manifest());
    } catch (error) {
      const response = publicArchiveError(error);
      res.status(response.status).json(response.body);
    }
  });

  app.get('/admin/api/legacy/records/:kind', limit(30, 10), requireAdmin, guard, async (req, res) => {
    const page = queryInteger(req.query.page, 1);
    const pageSize = queryInteger(req.query.pageSize, Math.min(50, ADMIN_RECORD_PAGE_SIZE_MAX));
    const result = await reader.records(String(req.params.kind ?? ''), page, pageSize).catch((error: unknown) => {
      const response = publicArchiveError(error);
      res.status(response.status).json(response.body);
      return null;
    });
    if (!result) return;
    if (!result.ok) {
      const status = result.error === 'unknown_record_kind' ? 404 : result.error === 'record_response_too_large' ? 413 : 400;
      res.status(status).json({ error: result.error });
      return;
    }
    deps.record({ time: Date.now(), level: 'info', subsystem: 'admin', event: 'legacy_records_read', message: 'Legacy archive records viewed', context: { kind: result.kind, page: result.page, pageSize: result.pageSize, ip: req.ip } });
    res.setHeader('cache-control', 'no-store');
    res.json(result);
  });
}
