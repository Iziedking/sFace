import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createRelayChainStub, createRelayPayoutService } from '../server/relay/payouts';
import { createRelayStore } from '../server/relay/store';

const directories: string[] = [];

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('Relay payout verification', () => {
  it('persists approved and submitted before verification, then verifies only exact chain evidence', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sface-relay-payout-'));
    directories.push(directory);
    const chain = createRelayChainStub({ network: 'test', confirmations: 10, sender: 'NQtreasury', recipient: 'NQwinner', valueLuna: 8_000_000_000, success: true, canonical: true });
    const service = createRelayPayoutService({ store: createRelayStore({ dataDirectory: directory }), chain, treasuryAddress: 'NQtreasury', minConfirmations: 10, network: 'test' });
    await service.create({ id: 'payout-1', period: 'week-1', walletAddress: 'NQwinner', amountLuna: 8_000_000_000 });
    await expect(service.approve('payout-1')).resolves.toMatchObject({ status: 'approved' });
    await expect(service.recordSubmitted('payout-1', 'hash-1')).resolves.toMatchObject({ status: 'submitted' });
    await expect(service.reconcile('payout-1')).resolves.toMatchObject({ status: 'verified' });
  });

  it('keeps insufficient confirmations pending and rejects wrong recipient/value/hash reuse', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sface-relay-payout-'));
    directories.push(directory);
    const chain = createRelayChainStub({ network: 'test', confirmations: 2, sender: 'NQtreasury', recipient: 'NQother', valueLuna: 1, success: true, canonical: true });
    const service = createRelayPayoutService({ store: createRelayStore({ dataDirectory: directory }), chain, treasuryAddress: 'NQtreasury', minConfirmations: 10, network: 'test' });
    await service.create({ id: 'payout-1', period: 'week-1', walletAddress: 'NQwinner', amountLuna: 8_000_000_000 });
    await service.approve('payout-1');
    await service.recordSubmitted('payout-1', 'hash-1');
    await expect(service.reconcile('payout-1')).resolves.toMatchObject({ status: 'failed' });
    await expect(service.recordSubmitted('payout-1', 'hash-1')).rejects.toMatchObject({ code: 'relay_payout_invalid_transition' });
  });

  it('does not verify a missing chain observation and rejects a hash reused by another payout', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sface-relay-payout-'));
    directories.push(directory);
    const chain = { observe: async () => null };
    const service = createRelayPayoutService({ store: createRelayStore({ dataDirectory: directory }), chain, treasuryAddress: 'NQtreasury', minConfirmations: 1, network: 'test' });
    await service.create({ id: 'payout-1', period: 'week-1', walletAddress: 'NQwinner', amountLuna: 1 });
    await service.approve('payout-1');
    await service.recordSubmitted('payout-1', 'hash-1');
    await expect(service.reconcile('payout-1')).resolves.toMatchObject({ status: 'confirming' });
    await service.create({ id: 'payout-2', period: 'week-1', walletAddress: 'NQwinner-2', amountLuna: 1 });
    await service.approve('payout-2');
    await expect(service.recordSubmitted('payout-2', 'hash-1')).rejects.toMatchObject({ code: 'relay_transaction_duplicate' });
  });
});
