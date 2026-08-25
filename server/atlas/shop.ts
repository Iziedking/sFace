import { validateAtlasShopItem, type AtlasShopFulfillment, type AtlasShopItem } from '../../shared/atlas/shop';
import type { AtlasNetwork } from '../../shared/atlas/types';

export type AtlasShopOrderStatus = 'created' | 'submitted' | 'confirming' | 'fulfilled' | 'cancelled';

export interface AtlasShopEvidence {
  lookup: string;
  network: AtlasNetwork;
  sender: string;
  recipient: string;
  valueLuna: number;
  canonical: boolean;
  success: boolean;
  confirmations: number;
  reorgDetected: boolean;
}

export interface AtlasShopOrder {
  id: string;
  actorId: string;
  walletAddress: string;
  itemId: string;
  fulfillment: AtlasShopFulfillment;
  network: AtlasNetwork;
  recipient: string;
  valueLuna: number;
  status: AtlasShopOrderStatus;
  lookup: string | null;
  failureReason: string | null;
  fulfilledAt: number | null;
}

export interface AtlasShopStore {
  create(input: { actorId: string; walletAddress: string; itemId: string; network: AtlasNetwork; recipient: string; valueLuna: number; idempotencyKey?: string }): Promise<AtlasShopOrder>;
  get(orderId: string): Promise<AtlasShopOrder>;
  submitLookup(orderId: string, lookup: string): Promise<AtlasShopOrder>;
  reconcile(orderId: string, evidence: AtlasShopEvidence | readonly AtlasShopEvidence[]): Promise<AtlasShopOrder>;
  cancel(orderId: string, reason: string): Promise<AtlasShopOrder>;
}

export function createAtlasShopStore(options: { catalog: readonly AtlasShopItem[]; mode: 'local' | 'mainnet'; now?: () => number; catalogNow?: Date }): AtlasShopStore {
  const now = options.now ?? Date.now;
  const catalog = new Map<string, AtlasShopItem>();
  for (const item of options.catalog) {
    const validated = validateAtlasShopItem(item, options.catalogNow ?? new Date());
    catalog.set(validated.id, validated);
  }
  const orders = new Map<string, AtlasShopOrder>();
  const actorWallets = new Map<string, string>();
  const lookupOwners = new Map<string, string>();
  const idempotency = new Map<string, { fingerprint: string; orderId: string }>();
  let sequence = 0;

  return {
    async create(input) {
      const item = catalog.get(input.itemId);
      if (!item) throw new Error('Atlas shop item was not found.');
      if (!item.enabled) throw new Error('Atlas shop item is disabled pending owner approval.');
      if (options.mode !== 'mainnet' && item.network === 'mainalbatross') throw new Error('Mainnet Atlas shop purchases are unavailable in local mode.');
      if (item.network !== input.network) throw new Error('Atlas shop network does not match the catalog.');
      if (item.recipient !== input.recipient) throw new Error('Atlas shop recipient does not match the catalog.');
      if (item.priceLuna !== input.valueLuna) throw new Error('Atlas shop Luna value does not match the catalog.');
      if (!input.actorId || !input.walletAddress) throw new Error('Atlas shop actor and wallet are required.');
      const fingerprint = JSON.stringify([input.actorId, input.walletAddress, input.itemId, input.network, input.recipient, input.valueLuna]);
      if (input.idempotencyKey !== undefined) {
        assertIdempotencyKey(input.idempotencyKey);
        const existing = idempotency.get(input.idempotencyKey);
        if (existing) {
          if (existing.fingerprint !== fingerprint) throw new Error('Atlas shop idempotency key is bound to different order fields.');
          return clone(requireOrder(orders, existing.orderId));
        }
      }
      const existingWallet = actorWallets.get(input.actorId);
      if (existingWallet && existingWallet !== input.walletAddress) throw new Error('Atlas shop actor is already bound to another wallet.');
      actorWallets.set(input.actorId, input.walletAddress);
      const order: AtlasShopOrder = {
        id: `atlas-shop-order-${++sequence}`, actorId: input.actorId, walletAddress: input.walletAddress, itemId: item.id, fulfillment: item.fulfillment,
        network: item.network, recipient: item.recipient, valueLuna: item.priceLuna, status: 'created', lookup: null, failureReason: null, fulfilledAt: null,
      };
      orders.set(order.id, order);
      if (input.idempotencyKey !== undefined) idempotency.set(input.idempotencyKey, { fingerprint, orderId: order.id });
      return clone(order);
    },
    async get(orderId) { return clone(requireOrder(orders, orderId)); },
    async submitLookup(orderId, lookup) {
      const order = requireOrder(orders, orderId);
      if (!/^[A-Za-z0-9._:-]{1,256}$/.test(lookup)) throw new Error('Atlas shop transaction hash is malformed.');
      if (order.status === 'fulfilled' || order.status === 'cancelled') throw new Error(`Atlas shop order is terminal: ${order.status}.`);
      const owner = lookupOwners.get(lookup);
      if (owner && owner !== order.id) throw new Error('Atlas shop transaction hash is already bound to another order.');
      if (order.status === 'submitted' || order.status === 'confirming') {
        if (order.lookup === lookup) return clone(order);
        throw new Error('Atlas shop order already has a different transaction hash.');
      }
      order.lookup = lookup;
      order.status = 'submitted';
      lookupOwners.set(lookup, order.id);
      return clone(order);
    },
    async reconcile(orderId, evidenceInput) {
      const order = requireOrder(orders, orderId);
      if (order.status === 'fulfilled') return clone(order);
      if (order.status === 'cancelled') throw new Error('Cancelled Atlas shop orders cannot be fulfilled.');
      const observations = Array.isArray(evidenceInput) ? [...evidenceInput] : [evidenceInput];
      if (observations.length === 0 || observations.some((observation) => !sameObservation(observations[0]!, observation))) throw new Error('Atlas RPC observations disagree.');
      const evidence = observations[0]!;
      if (order.lookup !== evidence.lookup) throw new Error('Atlas shop evidence hash does not match the order.');
      if (evidence.network !== order.network) throw new Error('Atlas shop evidence network does not match the order.');
      if (evidence.sender !== order.walletAddress) throw new Error('Atlas shop evidence wallet does not match the order.');
      if (evidence.recipient !== order.recipient) throw new Error('Atlas shop evidence recipient does not match the order.');
      if (evidence.valueLuna !== order.valueLuna) throw new Error('Atlas shop evidence Luna value does not match the order.');
      if (evidence.reorgDetected || !evidence.canonical || !evidence.success) throw new Error('Atlas shop payment is not canonical and successful.');
      if (!Number.isSafeInteger(evidence.confirmations) || evidence.confirmations < 3) {
        order.status = 'confirming';
        throw new Error('Atlas shop payment is still confirming.');
      }
      order.status = 'fulfilled';
      order.fulfilledAt = now();
      return clone(order);
    },
    async cancel(orderId, reason) {
      const order = requireOrder(orders, orderId);
      if (order.status === 'fulfilled') throw new Error('Fulfilled Atlas shop orders cannot be cancelled.');
      if (order.status === 'cancelled') return clone(order);
      order.status = 'cancelled';
      order.failureReason = reason.slice(0, 160);
      return clone(order);
    },
  };
}

function sameObservation(left: AtlasShopEvidence, right: AtlasShopEvidence): boolean {
  return left.lookup === right.lookup && left.network === right.network && left.sender === right.sender && left.recipient === right.recipient && left.valueLuna === right.valueLuna && left.canonical === right.canonical && left.success === right.success && left.confirmations === right.confirmations && left.reorgDetected === right.reorgDetected;
}

function requireOrder(orders: Map<string, AtlasShopOrder>, orderId: string): AtlasShopOrder {
  const order = orders.get(orderId);
  if (!order) throw new Error('Atlas shop order was not found.');
  return order;
}

function clone(order: AtlasShopOrder): AtlasShopOrder { return { ...order }; }

function assertIdempotencyKey(value: string): void {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(value)) throw new Error('Atlas shop idempotency key is malformed.');
}
