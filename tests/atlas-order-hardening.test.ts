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

  it('does not overwrite a stored order ledger after a failed hydration', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sface-atlas-order-hydrate-'));
    try {
      const repository = createAtlasJsonRepository({ directory });
      const seeded = createAtlasOrderStore({ recipient: RECIPIENT, priceLuna: 100_000, repository });
      const stored = await seeded.create({ actorId: 'actor-stored', walletAddress: WALLET, itemId: 'harbor-lantern', network: 'testalbatross', recipient: RECIPIENT, valueLuna: 100_000 });

      // A repository whose first read fails and whose later reads work is the
      // shape of a transient disk error on boot. The store must keep asking
      // rather than treating the one failure as an empty ledger, because the
      // next write persists whatever it believes it has.
      let reads = 0;
      const flaky = {
        ...repository,
        async load() {
          reads += 1;
          if (reads === 1) throw new Error('Atlas repository read failed transiently.');
          return repository.load();
        },
      };

      const restarted = createAtlasOrderStore({ recipient: RECIPIENT, priceLuna: 100_000, repository: flaky });
      await expect(restarted.get(stored.id)).rejects.toThrow('Atlas repository read failed transiently.');
      await expect(restarted.get(stored.id)).resolves.toMatchObject({ id: stored.id, status: 'created' });

      await restarted.create({ actorId: 'actor-after', walletAddress: WALLET, itemId: 'harbor-lantern', network: 'testalbatross', recipient: RECIPIENT, valueLuna: 100_000 });
      const reopened = createAtlasOrderStore({ recipient: RECIPIENT, priceLuna: 100_000, repository });
      await expect(reopened.get(stored.id)).resolves.toMatchObject({ id: stored.id, status: 'created' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rolls back a submitted order when persistence crashes after the in-memory mutation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sface-atlas-order-crash-'));
    try {
      let crash = false;
      const repository = createAtlasJsonRepository({ directory, hooks: { afterTempWrite: () => { if (crash) throw new Error('simulated order crash'); } } });
      const store = createAtlasOrderStore({ recipient: RECIPIENT, priceLuna: 100_000, repository });
      const order = await store.create({ actorId: 'actor-crash', walletAddress: WALLET, itemId: 'harbor-lantern', network: 'testalbatross', recipient: RECIPIENT, valueLuna: 100_000 });

      crash = true;
      await expect(store.submitLookup(order.id, 'lookup-crashed')).rejects.toThrow(/simulated order crash/);
      await expect(store.get(order.id)).resolves.toMatchObject({ status: 'created', lookup: null });

      const restored = createAtlasOrderStore({ recipient: RECIPIENT, priceLuna: 100_000, repository });
      await expect(restored.get(order.id)).resolves.toMatchObject({ status: 'created', lookup: null });
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

  it('keeps one order under one hundred concurrent idempotent creates', async () => {
    const store = createAtlasOrderStore({ recipient: RECIPIENT, priceLuna: 100_000 });
    const orders = await Promise.all(Array.from({ length: 100 }, () => store.create({ actorId: 'actor-concurrent', walletAddress: WALLET, itemId: 'harbor-lantern', network: 'testalbatross', recipient: RECIPIENT, valueLuna: 100_000, idempotencyKey: 'concurrent-create' })));
    expect(new Set(orders.map((order) => order.id)).size).toBe(1);
  });
});
