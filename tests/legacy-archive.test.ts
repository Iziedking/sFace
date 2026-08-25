import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';

import {
  legacyConfig,
  legacyMutationMiddleware,
  runLegacyMutation,
} from '../server/legacy/mode';
import {
  buildLegacyManifest,
  resolveLegacyArchivePath,
} from '../server/legacy/manifest';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('legacy public mode', () => {
  it('uses the locked archive defaults', () => {
    expect(legacyConfig({})).toEqual({
      publicExperience: 'relay',
      publicEnabled: false,
      writesEnabled: false,
      adminReadsEnabled: true,
    });
  });

  it('refuses a disabled legacy mutation without invoking the callback', () => {
    let called = false;

    const result = runLegacyMutation(legacyConfig({}), () => {
      called = true;
      return 'should not run';
    });

    expect(result).toEqual({
      ok: false,
      status: 410,
      error: 'legacy_experience_archived',
    });
    expect(called).toBe(false);
  });

  it('returns a structured 410 from the Express guard', async () => {
    const app = express();
    app.post('/legacy-write', legacyMutationMiddleware(legacyConfig({})));
    const server = await new Promise<ReturnType<typeof app.listen>>((resolveServer) => {
      const nextServer = app.listen(0, () => resolveServer(nextServer));
    });

    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Test server did not expose a port.');
      const response = await fetch(`http://127.0.0.1:${address.port}/legacy-write`, { method: 'POST' });
      expect(response.status).toBe(410);
      expect(await response.json()).toEqual({ error: 'legacy_experience_archived' });
    } finally {
      await new Promise<void>((resolveServer) => server.close(() => resolveServer()));
    }
  });
});

describe('legacy archive manifest', () => {
  it('reports bytes, checksum, snapshot version, source, and existing collections', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sface-legacy-'));
    temporaryDirectories.push(directory);
    const sourcePath = join(directory, 'sface.json');
    const raw = JSON.stringify({
      version: 1,
      scores: [['main:2026-08-24', [{ id: 'score-1' }]]],
      profiles: [{ id: 'profile-1' }],
      tips: { records: [{ id: 'tip-1' }], seen: [{ key: 'seen-1' }] },
      mission: { date: '2026-08-24' },
    });
    await writeFile(sourcePath, raw, 'utf8');

    const manifest = await buildLegacyManifest(sourcePath);

    expect(manifest.sourcePath).toBe(resolve(sourcePath));
    expect(manifest.snapshotVersion).toBe(1);
    expect(manifest.byteLength).toBe(Buffer.byteLength(raw));
    expect(manifest.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.recordCounts).toEqual({
      scores: 1,
      profiles: 1,
      'tips.records': 1,
      'tips.seen': 1,
      mission: 1,
    });
  });

  it('rejects archive paths outside the data directory', () => {
    const dataDirectory = resolve('fixture-data');
    expect(() => resolveLegacyArchivePath(dataDirectory, resolve('outside'))).toThrow('DATA_DIR');
    expect(resolveLegacyArchivePath(dataDirectory, join(dataDirectory, 'legacy-archive', 'manifest.json')))
      .toBe(join(dataDirectory, 'legacy-archive', 'manifest.json'));
  });

  it('does not change the source snapshot while reading a manifest', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sface-legacy-'));
    temporaryDirectories.push(directory);
    const sourcePath = join(directory, 'sface.json');
    await writeFile(sourcePath, '{"version":1,"scores":[]}', 'utf8');
    const before = await readFile(sourcePath);

    await buildLegacyManifest(sourcePath);

    expect(await readFile(sourcePath)).toEqual(before);
  });
});
