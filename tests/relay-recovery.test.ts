import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createEmptyRelaySnapshot, createRelayStore, relayPaths, type RelayRunRecord } from '../server/relay/store';

const directories: string[] = [];

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('Relay crash recovery boundaries', () => {
  it('replays an event after a crash between event append and snapshot replacement', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sface-relay-recovery-'));
    directories.push(directory);
    let crash = true;
    const store = createRelayStore({ dataDirectory: directory, afterEventAppended: async () => { if (crash) { crash = false; throw new Error('simulated boundary crash'); } } });
    const initial = await store.load();
    const run: RelayRunRecord = { id: 'run-1', actorId: 'actor-1', ticketId: 'ticket-1', walletAddress: 'NQ00TEST', missionDate: '2026-08-24', ruleset: 'relay-1', seedCommitment: 'a'.repeat(64), traceHash: 'b'.repeat(64), result: { score: 100, bankedNodes: 1, damageTaken: 0, bestChain: 1, integrityRemaining: 3, completedTicks: 1_350, repairUnits: 10 }, verification: 'verified', receivedAt: 1 };
    await mkdir(relayPaths(directory).traces, { recursive: true });
    await writeFile(join(relayPaths(directory).traces, `${run.traceHash}.trace`), 'trace', 'utf8');
    await expect(store.commit('run.accepted', { ...initial, verifiedRuns: { [run.id]: run }, dailyBests: { 'actor-1:2026-08-24': run.id } })).rejects.toThrow('simulated boundary crash');
    const recovered = await createRelayStore({ dataDirectory: directory }).load();
    expect(Object.keys(recovered.verifiedRuns)).toEqual(['run-1']);
    expect(recovered.dailyBests['actor-1:2026-08-24']).toBe('run-1');
    expect(recovered.lastEventSequence).toBe(1);
    expect(createEmptyRelaySnapshot().payouts).toEqual({});
  });
});
