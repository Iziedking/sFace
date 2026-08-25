import { describe, expect, it } from 'vitest';

import { ATLAS_LOCAL_TEST_SHOP_ITEM, ATLAS_MAINNET_SHOP_ITEMS, applyAtlasShopFulfillment, consumeAtlasShopHint, validateAtlasShopItem } from '../shared/atlas/shop';
import { createAtlasPlayerProgress, isAtlasPrizeEligible } from '../shared/atlas/roles';
import { createAtlasShopStore } from '../server/atlas/shop';

const localItem = ATLAS_LOCAL_TEST_SHOP_ITEM;
const evidence = {
  lookup: 'local-hash-1', network: 'testalbatross' as const, sender: 'NQLOCALWALLET', recipient: localItem.recipient!,
  valueLuna: localItem.priceLuna, canonical: true, success: true, confirmations: 3, reorgDetected: false,
};

describe('NIM Atlas optional shop boundary', () => {
  it('keeps mainnet items owner-gated and validates immutable catalog fields', () => {
    expect(ATLAS_MAINNET_SHOP_ITEMS).toHaveLength(3);
    for (const item of ATLAS_MAINNET_SHOP_ITEMS) {
      expect(item.network).toBe('mainalbatross');
      expect(item.enabled).toBe(false);
      expect(item.ownerGate).toBe(true);
      expect(item.recipient).toBeNull();
      expect(() => validateAtlasShopItem(item, new Date('2026-08-25T00:00:00.000Z'))).not.toThrow();
    }
    expect(() => validateAtlasShopItem({ ...localItem, priceLuna: 1.5 }, new Date('2026-08-25T00:00:00.000Z'))).toThrow(/price|integer/i);
    expect(() => validateAtlasShopItem({ ...localItem, fulfillment: 'answer-reveal' as never }, new Date('2026-08-25T00:00:00.000Z'))).toThrow(/fulfillment/i);
    expect(() => validateAtlasShopItem({ ...localItem, validUntil: '2026-01-01' }, new Date('2026-08-25T00:00:00.000Z'))).toThrow(/window|valid/i);
  });

  it('allows only an explicit local test item and records purchased assistance', () => {
    const store = createAtlasShopStore({ catalog: [localItem], mode: 'local', now: () => 100 });
    expect(() => applyAtlasShopFulfillment(createAtlasPlayerProgress(), localItem)).not.toThrow();
    const assisted = consumeAtlasShopHint(applyAtlasShopFulfillment(createAtlasPlayerProgress(), localItem), localItem);
    expect(assisted.inventoryItemIds).toContain(localItem.id);
    expect(assisted.assistance).toContain('purchased-hint');
    expect(isAtlasPrizeEligible(assisted)).toBe(false);
    return expect(store.create({ actorId: 'actor-1', walletAddress: 'NQLOCALWALLET', itemId: localItem.id, network: 'testalbatross', recipient: localItem.recipient!, valueLuna: localItem.priceLuna })).resolves.toMatchObject({ status: 'created', itemId: localItem.id });
  });

  it('binds exact wallet and payment fields, rejects duplicate hashes, and requires agreeing confirmations', async () => {
    const store = createAtlasShopStore({ catalog: [localItem], mode: 'local', now: () => 100 });
    const order = await store.create({ actorId: 'actor-1', walletAddress: 'NQLOCALWALLET', itemId: localItem.id, network: 'testalbatross', recipient: localItem.recipient!, valueLuna: localItem.priceLuna });
    await expect(store.create({ actorId: 'actor-1', walletAddress: 'NQOTHER', itemId: localItem.id, network: 'testalbatross', recipient: localItem.recipient!, valueLuna: localItem.priceLuna })).rejects.toThrow(/wallet|bound/i);
    await store.submitLookup(order.id, evidence.lookup);
    await expect(store.reconcile(order.id, [{ ...evidence, confirmations: 2 }, { ...evidence, confirmations: 3 }])).rejects.toThrow(/agree|rpc|confirm/i);
    await expect(store.reconcile(order.id, [{ ...evidence, canonical: false }, { ...evidence, canonical: false }])).rejects.toThrow(/canonical|reorg/i);
    await expect(store.reconcile(order.id, evidence)).resolves.toMatchObject({ status: 'fulfilled', fulfilledAt: 100 });
    const second = await store.create({ actorId: 'actor-2', walletAddress: 'NQSECONDWALLET', itemId: localItem.id, network: 'testalbatross', recipient: localItem.recipient!, valueLuna: localItem.priceLuna });
    await expect(store.submitLookup(second.id, evidence.lookup)).rejects.toThrow(/duplicate|hash/i);
  });

  it('keeps mainnet purchases unavailable until the owner configures a recipient and enables the item', async () => {
    const store = createAtlasShopStore({ catalog: ATLAS_MAINNET_SHOP_ITEMS, mode: 'local', now: () => 100 });
    const item = ATLAS_MAINNET_SHOP_ITEMS[0]!;
    await expect(store.create({ actorId: 'actor-1', walletAddress: 'NQLOCALWALLET', itemId: item.id, network: 'mainalbatross', recipient: 'NQREALRECIPIENT', valueLuna: item.priceLuna })).rejects.toThrow(/disabled|owner|recipient|mainnet/i);
  });
});
