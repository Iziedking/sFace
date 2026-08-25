import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createRelayStore } from '../server/relay/store';
import { createRelayWorldService } from '../server/relay/world';

const directories: string[] = [];

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('Relay shared-world projection', () => {
  it('caps one actor per day and applies only positive best-run deltas', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sface-relay-world-'));
    directories.push(directory);
    const service = createRelayWorldService({ store: createRelayStore({ dataDirectory: directory }), now: () => 100 });

    await expect(service.apply({ missionDate: '2026-08-24', actorId: 'actor-1', repairUnits: 60, target: 1_000 })).resolves.toMatchObject({ repairTotal: 60, projectionVersion: 1 });
    await expect(service.apply({ missionDate: '2026-08-24', actorId: 'actor-1', repairUnits: 40, target: 1_000 })).resolves.toMatchObject({ repairTotal: 60, projectionVersion: 1 });
    await expect(service.apply({ missionDate: '2026-08-24', actorId: 'actor-1', repairUnits: 140, target: 1_000 })).resolves.toMatchObject({ repairTotal: 100, projectionVersion: 2 });
    await expect(service.apply({ missionDate: '2026-08-24', actorId: 'actor-2', repairUnits: 5, target: 1_000 })).resolves.toMatchObject({ repairTotal: 105, verifiedPlayerCount: 2, projectionVersion: 3 });
  });

  it('serializes concurrent updates deterministically and preserves immutable day targets', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sface-relay-world-race-'));
    directories.push(directory);
    const service = createRelayWorldService({ store: createRelayStore({ dataDirectory: directory }) });
    const results = await Promise.all([
      service.apply({ missionDate: '2026-08-25', actorId: 'actor-a', repairUnits: 40, target: 500, unlockThresholds: [100, 250] }),
      service.apply({ missionDate: '2026-08-25', actorId: 'actor-b', repairUnits: 30, target: 999, unlockThresholds: [700] }),
    ]);
    expect(results.at(-1)).toMatchObject({ repairTotal: 70, target: 500, unlockThresholds: [100, 250], projectionVersion: 2 });
  });
});
