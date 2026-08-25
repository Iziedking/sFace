import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';

import { adminMiddleware } from '../server/admin/auth';
import { mountLegacyArchiveRoutes } from '../server/legacy/archive-routes';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture(): Promise<{ dataDirectory: string; source: string }> {
  const dataDirectory = await mkdtemp(join(tmpdir(), 'sface-admin-archive-'));
  temporaryDirectories.push(dataDirectory);
  const source = join(dataDirectory, 'sface.json');
  await writeFile(source, JSON.stringify({
    version: 1,
    profiles: [{ id: 'profile-1', bio: '<script>do-not-render</script>' }],
    scores: Array.from({ length: 3 }, (_, id) => ({ id })),
    chat: [{ id: 'chat-1', text: '<img src=x onerror=alert(1)>' }],
  }), 'utf8');
  return { dataDirectory, source };
}

async function runningArchive(dataDirectory: string, token = 'archive-token') {
  const app = express();
  mountLegacyArchiveRoutes({
    app,
    limit: () => (_req, _res, next) => next(),
    requireAdmin: adminMiddleware({ token, allowedIps: [] }),
    dataDirectory,
    adminReadsEnabled: true,
    sources: {
      profiles: () => [{ id: 'profile-1', bio: '<script>do-not-render</script>' }],
      scores: () => Array.from({ length: 3 }, (_, id) => ({ id })),
      chat: () => [{ id: 'chat-1', text: '<img src=x onerror=alert(1)>' }],
    },
    record: () => undefined,
  });
  const server = await new Promise<ReturnType<typeof app.listen>>((resolveServer) => {
    const nextServer = app.listen(0, () => resolveServer(nextServer));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not expose a port.');
  return { server, baseUrl: `http://127.0.0.1:${address.port}`, token };
}

describe('administrator-only legacy archive', () => {
  it('denies missing and wrong bearer tokens without private metadata', async () => {
    const { dataDirectory } = await fixture();
    const { server, baseUrl, token } = await runningArchive(dataDirectory);
    try {
      const missing = await fetch(`${baseUrl}/admin/api/legacy/manifest`);
      expect(missing.status).toBe(401);
      expect(await missing.json()).toEqual({ error: 'Admin access denied.' });
      const wrong = await fetch(`${baseUrl}/admin/api/legacy/manifest`, { headers: { authorization: 'Bearer wrong' } });
      expect(wrong.status).toBe(401);
      expect(await wrong.json()).toEqual({ error: 'Admin access denied.' });
      expect(JSON.stringify(await wrong.json().catch(() => ({})))).not.toContain(dataDirectory);
      expect(token).toBe('archive-token');
    } finally {
      await new Promise<void>((resolveServer) => server.close(() => resolveServer()));
    }
  });

  it('returns a no-store manifest and authorized paginated records', async () => {
    const { dataDirectory, source } = await fixture();
    const { server, baseUrl, token } = await runningArchive(dataDirectory);
    try {
      const manifestResponse = await fetch(`${baseUrl}/admin/api/legacy/manifest`, { headers: { authorization: `Bearer ${token}` } });
      expect(manifestResponse.status).toBe(200);
      expect(manifestResponse.headers.get('cache-control')).toContain('no-store');
      const manifest = await manifestResponse.json() as { sourcePath: string; snapshotVersion: number; byteLength: number; sha256: string; backupCount: number; lastVerifiedAt: number | null };
      expect(manifest.sourcePath).toBe(source);
      expect(manifest.snapshotVersion).toBe(1);
      expect(manifest.byteLength).toBeGreaterThan(0);
      expect(manifest.sha256).toBe(createHash('sha256').update(JSON.stringify({
        version: 1,
        profiles: [{ id: 'profile-1', bio: '<script>do-not-render</script>' }],
        scores: Array.from({ length: 3 }, (_, id) => ({ id })),
        chat: [{ id: 'chat-1', text: '<img src=x onerror=alert(1)>' }],
      })).digest('hex'));
      expect(manifest.backupCount).toBe(0);
      expect(manifest.lastVerifiedAt).toBeNull();

      const recordsResponse = await fetch(`${baseUrl}/admin/api/legacy/records/scores?page=1&pageSize=2`, { headers: { authorization: `Bearer ${token}` } });
      expect(recordsResponse.status).toBe(200);
      expect(await recordsResponse.json()).toMatchObject({ page: 1, pageSize: 2, totalRecords: 3, totalPages: 2, records: [{ id: 0 }, { id: 1 }] });
    } finally {
      await new Promise<void>((resolveServer) => server.close(() => resolveServer()));
    }
  });

  it('refuses unknown kinds, traversal, and oversized pages', async () => {
    const { dataDirectory } = await fixture();
    const { server, baseUrl, token } = await runningArchive(dataDirectory);
    const headers = { authorization: `Bearer ${token}` };
    try {
      expect((await fetch(`${baseUrl}/admin/api/legacy/records/unknown`, { headers })).status).toBe(404);
      expect((await fetch(`${baseUrl}/admin/api/legacy/records/%2e%2e`, { headers })).status).toBe(404);
      expect((await fetch(`${baseUrl}/admin/api/legacy/records/scores?pageSize=101`, { headers })).status).toBe(400);
    } finally {
      await new Promise<void>((resolveServer) => server.close(() => resolveServer()));
    }
  });

  it('refuses a corrupt archive manifest and a checksum-mismatched snapshot', async () => {
    const { dataDirectory } = await fixture();
    await mkdir(join(dataDirectory, 'legacy-archive'));
    await writeFile(join(dataDirectory, 'legacy-archive', 'manifest.json'), '{', 'utf8');
    const corrupt = await runningArchive(dataDirectory);
    try {
      expect((await fetch(`${corrupt.baseUrl}/admin/api/legacy/manifest`, { headers: { authorization: `Bearer ${corrupt.token}` } })).status).toBe(503);
    } finally {
      await new Promise<void>((resolveServer) => corrupt.server.close(() => resolveServer()));
    }

    await writeFile(join(dataDirectory, 'legacy-archive', 'manifest.json'), JSON.stringify({
      sourcePath: join(dataDirectory, 'sface.json'), snapshotVersion: 1, byteLength: 1, sha256: '0'.repeat(64), recordCounts: {},
    }), 'utf8');
    const mismatch = await runningArchive(dataDirectory);
    try {
      expect((await fetch(`${mismatch.baseUrl}/admin/api/legacy/manifest`, { headers: { authorization: `Bearer ${mismatch.token}` } })).status).toBe(503);
    } finally {
      await new Promise<void>((resolveServer) => mismatch.server.close(() => resolveServer()));
    }
  });

  it('denies an administrator IP outside the allowlist', async () => {
    const { dataDirectory } = await fixture();
    const app = express();
    mountLegacyArchiveRoutes({
      app,
      limit: () => (_req, _res, next) => next(),
      requireAdmin: adminMiddleware({ token: 'archive-token', allowedIps: ['198.51.100.7'] }),
      dataDirectory,
      adminReadsEnabled: true,
      sources: {},
      record: () => undefined,
    });
    const server = await new Promise<ReturnType<typeof app.listen>>((resolveServer) => {
      const nextServer = app.listen(0, () => resolveServer(nextServer));
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not expose a port.');
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/admin/api/legacy/manifest`, { headers: { authorization: 'Bearer archive-token' } });
      expect(response.status).toBe(401);
    } finally {
      await new Promise<void>((resolveServer) => server.close(() => resolveServer()));
    }
  });
});
