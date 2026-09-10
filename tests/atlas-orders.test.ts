import { describe, expect, it } from 'vitest';

import { LAST_LANTERN } from '../shared/atlas/adventures/last-lantern';
import { createAtlasOrderStore } from '../server/atlas/orders';

const evidence = {
  lookup: 'hash-1', network: 'testalbatross' as const, sender: 'NQwallet', recipient: LAST_LANTERN.recipient,
  valueLuna: LAST_LANTERN.priceLuna, canonical: true, success: true, confirmations: LAST_LANTERN.minimumConfirmations,
};

describe('NIM Atlas testnet order machine', () => {
  it('can bind the live catalog to a validated deployment recipient without changing the local fixture default', async () => {
    const recipient = `NQ00${'A'.repeat(32)}`;
    const store = createAtlasOrderStore({ recipient, priceLuna: 100_000 });
    await expect(store.create({ actorId: 'actor-live', walletAddress: 'NQwallet', itemId: 'harbor-lantern', network: 'testalbatross', recipient, valueLuna: 100_000 })).resolves.toMatchObject({ recipient, valueLuna: 100_000 });
    await expect(store.create({ actorId: 'actor-fixture', walletAddress: 'NQwallet', itemId: 'harbor-lantern', network: 'testalbatross', recipient: LAST_LANTERN.recipient, valueLuna: LAST_LANTERN.priceLuna })).rejects.toThrow(/catalog|recipient|exact/i);
  });

  it('binds the exact item, actor, wallet, network, recipient, and Luna value before submission', async () => {
    const store = createAtlasOrderStore({ now: () => 100 });
    const order = await store.create({ actorId: 'actor-1', walletAddress: 'NQwallet', itemId: LAST_LANTERN.request.itemId, network: LAST_LANTERN.request.network, recipient: LAST_LANTERN.recipient, valueLuna: LAST_LANTERN.priceLuna });
    expect(order).toMatchObject({ status: 'created', actorId: 'actor-1', walletAddress: 'NQwallet', recipient: LAST_LANTERN.recipient, valueLuna: LAST_LANTERN.priceLuna });
    await expect(store.create({ actorId: 'actor-1', walletAddress: 'NQwallet', itemId: LAST_LANTERN.request.itemId, network: LAST_LANTERN.request.network, recipient: 'NQwrong', valueLuna: LAST_LANTERN.priceLuna })).rejects.toThrow(/catalog|recipient|exact/i);
  });

  it('keeps provider lookup separate from canonical fulfillment and fulfills once', async () => {
    const store = createAtlasOrderStore({ now: () => 100 });
    const order = await store.create({ actorId: 'actor-1', walletAddress: 'NQwallet', itemId: LAST_LANTERN.request.itemId, network: LAST_LANTERN.request.network, recipient: LAST_LANTERN.recipient, valueLuna: LAST_LANTERN.priceLuna });
    await expect(store.submitLookup(order.id, 'hash-1')).resolves.toMatchObject({ status: 'submitted', lookup: 'hash-1' });
    await expect(store.get(order.id)).resolves.toMatchObject({ status: 'submitted', fulfilledAt: null });
    await expect(store.reconcile(order.id, evidence)).resolves.toMatchObject({ status: 'fulfilled', fulfilledAt: 100 });
    await expect(store.reconcile(order.id, evidence)).resolves.toMatchObject({ status: 'fulfilled', fulfilledAt: 100 });
    await expect(store.submitLookup(order.id, 'hash-2')).rejects.toThrow(/fulfilled|terminal/i);
  });

  it('refuses wrong chain evidence, hash-only proof, insufficient confirmations, and cancellation retries', async () => {
    const store = createAtlasOrderStore({ now: () => 100 });
    const order = await store.create({ actorId: 'actor-1', walletAddress: 'NQwallet', itemId: LAST_LANTERN.request.itemId, network: LAST_LANTERN.request.network, recipient: LAST_LANTERN.recipient, valueLuna: LAST_LANTERN.priceLuna });
    await store.submitLookup(order.id, 'hash-1');
    await expect(store.reconcile(order.id, { ...evidence, recipient: 'NQwrong' })).rejects.toThrow(/recipient/i);
    await expect(store.reconcile(order.id, { ...evidence, canonical: false })).rejects.toThrow(/canonical/i);
    await expect(store.reconcile(order.id, { ...evidence, confirmations: 0 })).rejects.toThrow(/confirm/i);
    await expect(store.cancel(order.id, 'wallet-cancelled')).resolves.toMatchObject({ status: 'cancelled', failureReason: 'wallet-cancelled' });
    await expect(store.cancel(order.id, 'retry')).resolves.toMatchObject({ status: 'cancelled', failureReason: 'wallet-cancelled' });
    const privateReasonOrder = await store.create({ actorId: 'actor-2', walletAddress: 'NQwallet', itemId: LAST_LANTERN.request.itemId, network: LAST_LANTERN.request.network, recipient: LAST_LANTERN.recipient, valueLuna: LAST_LANTERN.priceLuna });
    await expect(store.cancel(privateReasonOrder.id, 'wallet stack included a private diagnostic')).rejects.toThrow(/reason/i);
  });
});

/*
 * Order network. AtlasOrder.network, AtlasOrderStore.create's input,
 * AtlasOrderCatalog.network and isPersistedOrder all pinned the literal
 * 'testalbatross', while AtlasOrderEvidence.network already accepted both. So
 * a mainnet deployment could observe mainnet evidence but never create or
 * reload a mainnet order.
 *
 * The store takes its network from configuration alongside recipient and
 * price, and refuses any order that does not match, because the network is
 * part of what the player reviewed before approving.
 */
describe('NIM Atlas order network binding', () => {
  const recipient = `NQ00${'A'.repeat(32)}`;
  const base = { actorId: 'actor-1', walletAddress: 'NQWALLET', itemId: 'harbor-lantern' as const, recipient, valueLuna: 100_000 };

  it('creates an order on the configured mainnet catalog', async () => {
    const store = createAtlasOrderStore({ network: 'mainalbatross', recipient, priceLuna: 100_000 });
    await expect(store.create({ ...base, network: 'mainalbatross' })).resolves.toMatchObject({ network: 'mainalbatross', recipient });
  });

  it('refuses an order whose network is not the configured one', async () => {
    const store = createAtlasOrderStore({ network: 'mainalbatross', recipient, priceLuna: 100_000 });
    await expect(store.create({ ...base, network: 'testalbatross' })).rejects.toThrow(/approved lantern catalog/i);
  });

  it('still defaults to the practice network when none is configured', async () => {
    const store = createAtlasOrderStore({ recipient, priceLuna: 100_000 });
    await expect(store.create({ ...base, network: 'testalbatross' })).resolves.toMatchObject({ network: 'testalbatross' });
  });
});
