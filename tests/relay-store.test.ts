import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createEmptyRelaySnapshot,
  createRelayStore,
  relayPaths,
  verifyLegacySnapshotChecksum,
  type RelayRunRecord,
} from '../server/relay/store';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'sface-relay-store-'));
  temporaryDirectories.push(directory);
  return directory;
}

const run: RelayRunRecord = {
  id: 'run-1',
  actorId: 'actor-1',
  ticketId: 'ticket-1',
  walletAddress: 'NQ00TEST',
  missionDate: '2026-08-24',
  ruleset: 'relay-1',
  seedCommitment: 'a'.repeat(64),
  traceHash: 'b'.repeat(64),
  result: {
    score: 100,
    bankedNodes: 1,
    damageTaken: 0,
    bestChain: 1,
    integrityRemaining: 3,
    completedTicks: 1_350,
    repairUnits: 10,
  },
  verification: 'verified',
  receivedAt: 1,
};

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('isolated Relay persistence', () => {
  it('creates a version-one Relay state without resolving the legacy snapshot path', async () => {
    const dataDirectory = await temporaryDirectory();
    const paths = relayPaths(dataDirectory);
    const store = createRelayStore({ dataDirectory });

    const loaded = await store.load();

    expect(loaded).toEqual(createEmptyRelaySnapshot());
    expect(paths.snapshot).toBe(join(dataDirectory, 'relay.json'));
    expect(paths.snapshot).not.toContain('sface.json');
    expect(paths.events).toBe(join(dataDirectory, 'relay-events.ndjson'));
    expect(paths.traces).toBe(join(dataDirectory, 'relay-traces'));
  });

  it('refuses corrupt and unsupported Relay snapshots at startup', async () => {
    const dataDirectory = await temporaryDirectory();
    const paths = relayPaths(dataDirectory);
    await writeFile(paths.snapshot, '{', 'utf8');
    await expect(createRelayStore({ dataDirectory }).load()).rejects.toMatchObject({ code: 'relay_snapshot_corrupt' });

    await writeFile(paths.snapshot, JSON.stringify({ version: 2 }), 'utf8');
    await expect(createRelayStore({ dataDirectory }).load()).rejects.toMatchObject({ code: 'relay_snapshot_unsupported' });

    await writeFile(paths.snapshot, JSON.stringify({ ...createEmptyRelaySnapshot(), actors: [] }), 'utf8');
    await expect(createRelayStore({ dataDirectory }).load()).rejects.toMatchObject({ code: 'relay_snapshot_corrupt' });
  });

  it('never overwrites a trace with different bytes under an existing hash', async () => {
    const dataDirectory = await temporaryDirectory();
    const { createRelayTraceStore, hashRelayTraceBytes } = await import('../server/relay/traces');
    const traces = createRelayTraceStore({ directory: relayPaths(dataDirectory).traces });
    const bytes = new TextEncoder().encode('immutable trace');
    const hash = hashRelayTraceBytes(bytes);

    await traces.save(hash, bytes);
    await expect(traces.save(hash, bytes)).resolves.toBeUndefined();
    await writeFile(traces.pathFor(hash), 'different bytes', 'utf8');
    await expect(traces.save(hash, bytes)).rejects.toMatchObject({ code: 'relay_trace_conflict' });
  });

  it('refuses a verified run whose trace is missing', async () => {
    const dataDirectory = await temporaryDirectory();
    const paths = relayPaths(dataDirectory);
    await writeFile(paths.snapshot, JSON.stringify({ ...createEmptyRelaySnapshot(), verifiedRuns: { [run.id]: run } }), 'utf8');

    await expect(createRelayStore({ dataDirectory }).load()).rejects.toMatchObject({ code: 'relay_trace_missing' });
  });

  it('refuses a truncated event log instead of silently dropping the last transition', async () => {
    const dataDirectory = await temporaryDirectory();
    const paths = relayPaths(dataDirectory);
    await writeFile(paths.snapshot, JSON.stringify(createEmptyRelaySnapshot()), 'utf8');
    await writeFile(paths.events, '{"version":1,"sequence":1', 'utf8');

    await expect(createRelayStore({ dataDirectory }).load()).rejects.toMatchObject({ code: 'relay_event_log_truncated' });
  });

  it('refuses a legacy snapshot whose recorded checksum does not match', async () => {
    const dataDirectory = await temporaryDirectory();
    const legacyPath = join(dataDirectory, 'legacy-snapshot.json');
    await writeFile(legacyPath, 'legacy bytes', 'utf8');

    await expect(verifyLegacySnapshotChecksum(legacyPath, '0'.repeat(64))).rejects.toMatchObject({ code: 'legacy_snapshot_checksum_mismatch' });
  });

  it('recovers an event committed before a materialized snapshot replacement', async () => {
    const dataDirectory = await temporaryDirectory();
    let failAfterEvent = true;
    const store = createRelayStore({
      dataDirectory,
      afterEventAppended: async () => {
        if (failAfterEvent) {
          failAfterEvent = false;
          throw new Error('simulated snapshot crash');
        }
      },
    });
    const initial = await store.load();
    const next = { ...initial, verifiedRuns: { [run.id]: run }, dailyBests: { [`${run.actorId}:${run.missionDate}`]: run.id } };
    await mkdir(relayPaths(dataDirectory).traces, { recursive: true });
    await writeFile(join(relayPaths(dataDirectory).traces, `${run.traceHash}.trace`), 'trace', 'utf8');

    await expect(store.commit('run.accepted', next)).rejects.toThrow('simulated snapshot crash');

    const recovered = await createRelayStore({ dataDirectory }).load();
    expect(recovered.verifiedRuns[run.id]).toEqual(run);
    expect(recovered.dailyBests[`${run.actorId}:${run.missionDate}`]).toBe(run.id);
    expect((await readFile(relayPaths(dataDirectory).events, 'utf8')).trim()).not.toBe('');
  });
});
