import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createAtlasJsonRepository } from '../server/atlas/persistence';
import { createAtlasOrderStore, toPublicAtlasOrder } from '../server/atlas/orders';

const RECIPIENT = `NQ00${'A'.repeat(32)}`;
const WALLET = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000';

describe('NIM Atlas live order hardening', () => {
  it('uses unguessable order ids and never exposes actor, wallet, or provider lookup in public order data', async () => {
    const store = createAtlasOrderStore({ recipient: RECIPIENT, priceLuna: 100_000 });
    const first = await store.create({ actorId: 'actor-private', walletAddress: WALLET, itemId: 'harbor-lantern', network: 'testalbatross', recipient: RECIPIENT, valueLuna: 100_000 });
    const second = await store.create({ actorId: 'actor-two', walletAddress: WALLET, itemId: 'harbor-lantern', network: 'testalbatross', recipient: RECIPIENT, valueLuna: 100_000 });
    expect(first.id).toMatch(/^atlas-order-[0-9a-f-]{36}$/);
    expect(second.id).not.toBe(first.id);

    await store.submitLookup(first.id, 'private-provider-lookup');
    const publicOrder = toPublicAtlasOrder(await store.get(first.id));
    expect(publicOrder).not.toHaveProperty('actorId');
    expect(publicOrder).not.toHaveProperty('walletAddress');
    expect(publicOrder).not.toHaveProperty('lookup');
    expect(JSON.stringify(publicOrder)).not.toContain('actor-private');
    expect(JSON.stringify(publicOrder)).not.toContain(WALLET);
    expect(JSON.stringify(publicOrder)).not.toContain('private-provider-lookup');
  });

  it('restores a submitted order after a clean process restart before reconciliation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sface-atlas-orders-'));
    try {
      const repository = createAtlasJsonRepository({ directory });
      const firstStore = createAtlasOrderStore({ recipient: RECIPIENT, priceLuna: 100_000, repository });
      const order = await firstStore.create({ actorId: 'actor-1', walletAddress: WALLET, itemId: 'harbor-lantern', network: 'testalbatross', recipient: RECIPIENT, valueLuna: 100_000, idempotencyKey: 'attempt-1' });
      await firstStore.submitLookup(order.id, 'lookup-after-restart');

      const restoredStore = createAtlasOrderStore({ recipient: RECIPIENT, priceLuna: 100_000, repository });
      await expect(restoredStore.get(order.id)).resolves.toMatchObject({ status: 'submitted', lookup: 'lookup-after-restart' });
      await expect(restoredStore.reconcile(order.id, {
        lookup: 'lookup-after-restart', network: 'testalbatross', sender: WALLET, recipient: RECIPIENT,
        valueLuna: 100_000, canonical: true, success: true, confirmations: 3,
      })).resolves.toMatchObject({ status: 'fulfilled' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('fails closed instead of silently discarding a malformed persisted order ledger', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sface-atlas-malformed-'));
    try {
      const repository = createAtlasJsonRepository({ directory });
      await repository.save({ version: 1, updatedAt: 1, records: { 'atlas-orders-v1': { version: 1, orders: [{ id: 'predictable-order' }], idempotency: [] } } });
      const store = createAtlasOrderStore({ recipient: RECIPIENT, priceLuna: 100_000, repository });
      await expect(store.get('predictable-order')).rejects.toThrow(/persisted|snapshot|ledger/i);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
