import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createRelayRepository } from '../server/relay/repository';
import { createRelayStore, type RelayRunRecord } from '../server/relay/store';
import { createRelayTraceStore, hashRelayTraceBytes } from '../server/relay/traces';
import { createRelayWorldService } from '../server/relay/world';

const directories: string[] = [];

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function run(id: string, traceHash: string): RelayRunRecord {
  return { id, actorId: 'actor-1', ticketId: 'ticket-1', walletAddress: 'NQ00TEST', missionDate: '2026-08-24', ruleset: 'relay-1', seedCommitment: 'a'.repeat(64), traceHash, result: { score: 100, bankedNodes: 1, damageTaken: 0, bestChain: 1, integrityRemaining: 3, completedTicks: 1_350, repairUnits: 10 }, verification: 'verified', receivedAt: 1 };
}

describe('Relay concurrent load boundaries', () => {
  it('accepts exactly one of 100 duplicate run submissions and one world delta', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sface-relay-load-'));
    directories.push(directory);
    const store = createRelayStore({ dataDirectory: directory });
    const bytes = new TextEncoder().encode('same trace');
    const traceHash = await hashRelayTraceBytes(bytes);
    const repository = createRelayRepository({ store, traces: createRelayTraceStore({ directory: join(directory, 'relay-traces') }) });
    const results = await Promise.allSettled(Array.from({ length: 100 }, () => repository.acceptRun(run('run-1', traceHash), bytes)));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(99);

    const world = createRelayWorldService({ store });
    const projections = await Promise.all(Array.from({ length: 100 }, () => world.apply({ missionDate: '2026-08-24', actorId: 'actor-1', repairUnits: 10, target: 1_000 })));
    expect(Math.max(...projections.map((projection) => projection.repairTotal))).toBe(10);
    expect(new Set(projections.map((projection) => projection.projectionVersion))).toEqual(new Set([1]));
  });
});
