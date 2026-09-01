import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ATLAS_PRODUCTION_GATE } from '../server/atlas/config';
import { createAtlasJsonRepository, type AtlasRepositorySnapshot } from '../server/atlas/persistence';
import { closeAtlasDailyPool } from '../shared/atlas/rewards';

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

function checkpointSnapshot(stage: string, payload: unknown): AtlasRepositorySnapshot {
  return { version: 1, updatedAt: 100, records: { checkpoint: { stage, payload } } };
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

  it('keeps the prior durable checkpoint across every Atlas lifecycle crash point', async () => {
    let crash = false;
    const store = await repository({ hooks: { afterTempWrite: () => { if (crash) throw new Error('simulated lifecycle crash'); } } });
    await store.save(checkpointSnapshot('initial', { status: 'empty' }));

    const checkpoints: Array<[string, unknown]> = [
      ['accepted-run', { runId: 'run-accepted', status: 'verified', prizeEligible: true }],
      ['order-submission', { orderId: 'order-submitted', status: 'submitted', lookupSubmitted: true }],
      ['reconciliation', { orderId: 'order-submitted', status: 'confirming', confirmations: 2 }],
      ['fulfillment', { orderId: 'order-submitted', status: 'fulfilled', itemId: 'harbor-lantern' }],
      ['daily-close', closeAtlasDailyPool(3)],
      ['reward-obligation', { period: 'week-1', role: 'explorer', status: 'pending-close', amountLuna: 300_000_000 }],
      ['payout-update', { payoutId: 'payout-1', status: 'verified', amountLuna: 300_000_000 }],
    ];

    let previous = checkpointSnapshot('initial', { status: 'empty' });
    for (const [stage, payload] of checkpoints) {
      const next = checkpointSnapshot(stage, payload);
      crash = true;
      await expect(store.save(next)).rejects.toThrow(/simulated lifecycle crash/);
      expect((await store.load()).snapshot).toEqual(previous);
      crash = false;
      await store.save(next);
      expect((await store.load()).snapshot).toEqual(next);
      previous = next;
    }
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

  it('gates the live server on that constant instead of on its own copies of it', () => {
    // Asserting the constant alone is what let this drift: the server carried a
    // hardcoded `competitiveExpeditions: false` and a hardcoded refusal string,
    // so both doors could be opened without turning this test red. The wiring
    // is the property worth pinning, not just the values.
    const server = readFileSync(new URL('../server/index.ts', import.meta.url), 'utf8');
    expect(server).toContain('ATLAS_PRODUCTION_GATE.competitive');
    expect(server).toContain('ATLAS_PRODUCTION_GATE.durableRepository');
    expect(server).not.toContain('competitiveExpeditions: false');
  });
});
