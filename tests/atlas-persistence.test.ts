import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ATLAS_PRODUCTION_GATE } from '../server/atlas/config';
import { createAtlasJsonRepository, type AtlasRepositorySnapshot } from '../server/atlas/persistence';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function repository(options: Parameters<typeof createAtlasJsonRepository>[0] = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'sface-atlas-persistence-'));
  temporaryDirectories.push(directory);
  return createAtlasJsonRepository({ directory: join(directory, 'atlas'), now: () => 100, ...options });
}

function snapshot(value: string): AtlasRepositorySnapshot {
  return { version: 1, updatedAt: 100, records: { value } };
}

describe('isolated Atlas persistence', () => {
  it('uses an Atlas-only path and atomically saves, backs up, and loads snapshots', async () => {
    const store = await repository();
    await store.save(snapshot('one'));
    await store.save(snapshot('two'));
    const loaded = await store.load();
    expect(loaded).toEqual({ snapshot: snapshot('two'), recoveredFromBackup: false });
    expect(store.snapshotPath).toMatch(/atlas[\\/]atlas\.json$/);
    expect(store.snapshotPath).not.toMatch(/sface\.json$/);
    expect(await store.listBackups()).toHaveLength(1);
  });

  it('serializes concurrent writes and leaves the prior snapshot intact after a crash point', async () => {
    const store = await repository();
    await store.save(snapshot('stable'));
    await Promise.all([store.save(snapshot('first')), store.save(snapshot('second'))]);
    expect((await store.load()).snapshot).toEqual(snapshot('second'));
    let crash = false;
    const crashing = await repository({ hooks: { afterTempWrite: () => { if (crash) throw new Error('simulated crash'); } } });
    await crashing.save(snapshot('stable'));
    crash = true;
    await expect(crashing.save(snapshot('lost'))).rejects.toThrow(/simulated crash/);
    expect((await crashing.load()).snapshot).toEqual(snapshot('stable'));
  });

  it('clears a stale lock, ignores partial temp files, and recovers a valid backup after corruption', async () => {
    const store = await repository({ lockStaleMs: 1 });
    await store.save(snapshot('recoverable'));
    await mkdir(store.lockPath);
    const old = new Date(0);
    await utimes(store.lockPath, old, old);
    await writeFile(`${store.snapshotPath}.partial.tmp`, '{', 'utf8');
    await store.save(snapshot('latest'));
    await writeFile(store.snapshotPath, '{', 'utf8');
    expect(await store.load()).toEqual({ snapshot: snapshot('recoverable'), recoveredFromBackup: true });
  });

  it('keeps competitive, reward, and durable-production switches off pending owner approval', () => {
    expect(ATLAS_PRODUCTION_GATE).toEqual({ competitive: false, rewards: false, durableRepository: false });
  });
});
