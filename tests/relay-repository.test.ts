import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createRelayRepository, type RelayPayoutRecord } from '../server/relay/repository';
import { createRelayStore, type RelayRunRecord } from '../server/relay/store';
import { createRelayTraceStore, hashRelayTraceBytes } from '../server/relay/traces';

const temporaryDirectories: string[] = [];

async function fixture(): Promise<{
  directory: string;
  repository: ReturnType<typeof createRelayRepository>;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'sface-relay-repository-'));
  temporaryDirectories.push(directory);
  const store = createRelayStore({ dataDirectory: directory });
  const traces = createRelayTraceStore({ directory: join(directory, 'relay-traces') });
  const repository = createRelayRepository({ store, traces });
  await store.load();
  return { directory, repository };
}

function makeRun(id: string, actorId = 'actor-1', score = 100): RelayRunRecord {
  return {
    id,
    actorId,
    ticketId: `ticket-${id}`,
    walletAddress: 'NQ00TEST',
    missionDate: '2026-08-24',
    ruleset: 'relay-1',
    seedCommitment: 'a'.repeat(64),
    traceHash: '0'.repeat(64),
    result: {
      score,
      bankedNodes: 1,
      damageTaken: 0,
      bestChain: 1,
      integrityRemaining: 3,
      completedTicks: 1_350,
      repairUnits: 10,
    },
    verification: 'verified',
    receivedAt: Date.now(),
  };
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('Relay repository uniqueness and critical writes', () => {
  it('accepts a run only after its content-hashed trace is durably stored', async () => {
    const { repository } = await fixture();
    const bytes = new TextEncoder().encode('trace bytes');
    const run = { ...makeRun('run-1'), traceHash: await hashRelayTraceBytes(bytes) };

    await expect(repository.acceptRun(run, bytes)).resolves.toEqual(run);
    await expect(repository.getRun(run.id)).resolves.toEqual(run);
    await expect(repository.getRun('missing-run')).resolves.toBeNull();
  });

  it('rejects duplicate run ids, ticket reuse, and trace reuse by another actor', async () => {
    const { repository } = await fixture();
    const bytes = new TextEncoder().encode('trace bytes');
    const traceHash = await hashRelayTraceBytes(bytes);
    const first = { ...makeRun('run-1'), traceHash, ticketId: 'ticket-1' };
    await repository.acceptRun(first, bytes);

    await expect(repository.acceptRun(first, bytes)).rejects.toMatchObject({ code: 'relay_duplicate_run' });
    await expect(repository.acceptRun({ ...makeRun('run-2'), traceHash, ticketId: 'ticket-1' }, bytes)).rejects.toMatchObject({ code: 'relay_ticket_used' });
    await expect(repository.acceptRun({ ...makeRun('run-3', 'actor-2'), traceHash, ticketId: 'ticket-2' }, bytes)).rejects.toMatchObject({ code: 'relay_trace_reused' });
  });

  it('serializes concurrent submissions so only one can consume a ticket', async () => {
    const { repository } = await fixture();
    const bytes = new TextEncoder().encode('concurrent trace');
    const traceHash = await hashRelayTraceBytes(bytes);
    const left = { ...makeRun('run-left'), traceHash, ticketId: 'ticket-race' };
    const right = { ...makeRun('run-right'), traceHash: await hashRelayTraceBytes(new TextEncoder().encode('other trace')), ticketId: 'ticket-race' };

    const results = await Promise.allSettled([repository.acceptRun(left, bytes), repository.acceptRun(right, new TextEncoder().encode('other trace'))]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });

  it('enforces one best per actor and day while retaining the higher score', async () => {
    const { repository } = await fixture();
    const firstBytes = new TextEncoder().encode('first');
    const secondBytes = new TextEncoder().encode('second');
    const first = { ...makeRun('run-1', 'actor-1', 100), traceHash: await hashRelayTraceBytes(firstBytes), ticketId: 'ticket-1' };
    const lower = { ...makeRun('run-2', 'actor-1', 90), traceHash: await hashRelayTraceBytes(secondBytes), ticketId: 'ticket-2' };
    const higherBytes = new TextEncoder().encode('higher');
    const higher = { ...makeRun('run-3', 'actor-1', 120), traceHash: await hashRelayTraceBytes(higherBytes), ticketId: 'ticket-3' };

    await repository.acceptRun(first, firstBytes);
    await expect(repository.acceptRun(lower, secondBytes)).rejects.toMatchObject({ code: 'relay_daily_best_exists' });
    await expect(repository.acceptRun(higher, higherBytes)).resolves.toEqual(higher);
  });

  it('rejects duplicate wallet-period rewards and transaction hashes', async () => {
    const { repository } = await fixture();
    const payout: RelayPayoutRecord = {
      id: 'payout-1', period: 'week-1', walletAddress: 'NQ00TEST', amountLuna: 1_000, transactionHash: 'c'.repeat(64), status: 'pending', createdAt: 1,
    };

    await expect(repository.recordPayout(payout)).resolves.toEqual(payout);
    await expect(repository.recordPayout({ ...payout, id: 'payout-2' })).rejects.toMatchObject({ code: 'relay_reward_duplicate' });
    await expect(repository.recordPayout({ ...payout, id: 'payout-3', walletAddress: 'NQ01TEST', period: 'week-2' })).rejects.toMatchObject({ code: 'relay_transaction_duplicate' });
  });
});
