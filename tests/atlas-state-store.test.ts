import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createAtlasJsonRepository, createAtlasStateStore } from '../server/atlas/persistence';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('durable Atlas projection store', () => {
  it('persists independent service records atomically and restores them', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sface-atlas-state-'));
    directories.push(directory);
    const repository = createAtlasJsonRepository({ directory });
    const store = createAtlasStateStore(repository, () => 123);

    await store.save('beacon', { projectionVersion: 1 });
    await store.save('echoes', { lastUpdatedAt: 123 });

    const restored = createAtlasStateStore(createAtlasJsonRepository({ directory }));
    await expect(restored.load('beacon', null)).resolves.toEqual({ projectionVersion: 1 });
    await expect(restored.load('echoes', null)).resolves.toEqual({ lastUpdatedAt: 123 });
  });

  it('serializes concurrent writes without losing the earlier record', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sface-atlas-state-'));
    directories.push(directory);
    const store = createAtlasStateStore(createAtlasJsonRepository({ directory }));
    await Promise.all([
      store.save('beacon', { value: 'first' }),
      store.save('echoes', { value: 'second' }),
    ]);

    const restored = createAtlasStateStore(createAtlasJsonRepository({ directory }));
    await expect(restored.load('beacon', null)).resolves.toEqual({ value: 'first' });
    await expect(restored.load('echoes', null)).resolves.toEqual({ value: 'second' });
  });
});
