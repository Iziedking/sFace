import type { AtlasAssistance, AtlasPlayerProgressV2, AtlasNetwork } from './types';

export type AtlasShopItemType = 'expansion-page' | 'hint' | 'cosmetic';
export type AtlasShopFulfillment = 'knowledge-expansion' | 'consumable-hint' | 'cosmetic';

export interface AtlasShopItem {
  id: string;
  type: AtlasShopItemType;
  fulfillment: AtlasShopFulfillment;
  network: AtlasNetwork;
  recipient: string | null;
  priceLuna: number;
  enabled: boolean;
  ownerGate: boolean;
  testOnly: boolean;
  validFrom: string;
  validUntil: string;
}

export const ATLAS_MAINNET_SHOP_ITEMS: readonly AtlasShopItem[] = [
  { id: 'knowledge-expansion-1', type: 'expansion-page', fulfillment: 'knowledge-expansion', network: 'mainalbatross', recipient: null, priceLuna: 100_000, enabled: false, ownerGate: true, testOnly: false, validFrom: '2026-08-25', validUntil: '2027-02-28' },
  { id: 'hint-lantern-1', type: 'hint', fulfillment: 'consumable-hint', network: 'mainalbatross', recipient: null, priceLuna: 50_000, enabled: false, ownerGate: true, testOnly: false, validFrom: '2026-08-25', validUntil: '2027-02-28' },
  { id: 'harbor-cosmetic-1', type: 'cosmetic', fulfillment: 'cosmetic', network: 'mainalbatross', recipient: null, priceLuna: 75_000, enabled: false, ownerGate: true, testOnly: false, validFrom: '2026-08-25', validUntil: '2027-02-28' },
];

export const ATLAS_LOCAL_TEST_SHOP_ITEM: AtlasShopItem = {
  id: 'local-hint-lantern-1', type: 'hint', fulfillment: 'consumable-hint', network: 'testalbatross', recipient: 'LOCAL_FIXTURE_RECIPIENT', priceLuna: 50_000,
  enabled: true, ownerGate: false, testOnly: true, validFrom: '2026-08-25', validUntil: '2027-02-28',
};

export const ATLAS_SHOP_ITEMS: readonly AtlasShopItem[] = [...ATLAS_MAINNET_SHOP_ITEMS, ATLAS_LOCAL_TEST_SHOP_ITEM];

export function validateAtlasShopItem(item: AtlasShopItem, now = new Date()): AtlasShopItem {
  if (!/^[a-z0-9-]{1,80}$/.test(item.id)) throw new Error('Atlas shop item id is malformed.');
  if (!['expansion-page', 'hint', 'cosmetic'].includes(item.type)) throw new Error('Atlas shop item type is invalid.');
  if (!['knowledge-expansion', 'consumable-hint', 'cosmetic'].includes(item.fulfillment)) throw new Error('Atlas shop fulfillment is invalid.');
  if ((item.type === 'expansion-page' && item.fulfillment !== 'knowledge-expansion') || (item.type === 'hint' && item.fulfillment !== 'consumable-hint') || (item.type === 'cosmetic' && item.fulfillment !== 'cosmetic')) throw new Error('Atlas shop type and fulfillment do not match.');
  if (item.network !== 'testalbatross' && item.network !== 'mainalbatross') throw new Error('Atlas shop network is invalid.');
  if (!Number.isSafeInteger(item.priceLuna) || item.priceLuna <= 0) throw new Error('Atlas shop price must be a positive integer Luna value.');
  const from = parseDate(item.validFrom);
  const until = parseDate(item.validUntil);
  if (from === null || until === null || from > until) throw new Error('Atlas shop validity window is invalid.');
  if (now.getTime() < from || now.getTime() > until + 86_399_999) throw new Error('Atlas shop item is outside its validity window.');
  if (item.network === 'mainalbatross' && (item.enabled || !item.ownerGate || item.testOnly || item.recipient !== null)) throw new Error('Mainnet Atlas shop items must remain disabled, recipient-free, and owner-gated.');
  if (item.network === 'testalbatross' && (!item.testOnly || !item.enabled || item.ownerGate || !item.recipient?.startsWith('LOCAL_FIXTURE_'))) throw new Error('Testnet Atlas shop items must be explicit local fixtures.');
  if (item.enabled && !item.recipient) throw new Error('Enabled Atlas shop items require a recipient.');
  return structuredClone(item);
}

export function applyAtlasShopFulfillment(progress: AtlasPlayerProgressV2, item: AtlasShopItem): AtlasPlayerProgressV2 {
  validateAtlasShopItem(item);
  if (item.fulfillment === 'knowledge-expansion') return { ...progress, expansionPageIds: [...new Set([...progress.expansionPageIds, item.id])] };
  if (item.fulfillment === 'consumable-hint') return { ...progress, inventoryItemIds: [...new Set([...progress.inventoryItemIds, item.id])] };
  return { ...progress, inventoryItemIds: [...new Set([...progress.inventoryItemIds, item.id])] };
}

export function consumeAtlasShopHint(progress: AtlasPlayerProgressV2, item: AtlasShopItem): AtlasPlayerProgressV2 {
  if (item.fulfillment !== 'consumable-hint' || !progress.inventoryItemIds.includes(item.id)) throw new Error('Atlas hint entitlement is missing.');
  return { ...progress, assistance: [...new Set([...progress.assistance, 'purchased-hint' as AtlasAssistance])] };
}

function parseDate(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) ? parsed : null;
}
