import { LAST_LANTERN } from '../../shared/atlas/adventures/last-lantern';

export type AtlasOrderStatus = 'created' | 'submitted' | 'confirming' | 'fulfilled' | 'cancelled';

export interface AtlasOrderEvidence {
  lookup: string;
  network: 'testalbatross' | 'mainalbatross';
  sender: string;
  recipient: string;
  valueLuna: number;
  canonical: boolean;
  success: boolean;
  confirmations: number;
}

export interface AtlasOrder {
  id: string;
  actorId: string;
  walletAddress: string;
  itemId: 'harbor-lantern';
  network: 'testalbatross';
  recipient: string;
  valueLuna: number;
  status: AtlasOrderStatus;
  lookup: string | null;
  failureReason: string | null;
  fulfilledAt: number | null;
}

export interface AtlasOrderStore {
  create(input: { actorId: string; walletAddress: string; itemId: 'harbor-lantern'; network: 'testalbatross'; recipient: string; valueLuna: number; idempotencyKey?: string }): Promise<AtlasOrder>;
  get(orderId: string): Promise<AtlasOrder>;
  submitLookup(orderId: string, lookup: string): Promise<AtlasOrder>;
  reconcile(orderId: string, evidence: AtlasOrderEvidence): Promise<AtlasOrder>;
  cancel(orderId: string, reason: string): Promise<AtlasOrder>;
}

export function createAtlasOrderStore(options: { now?: () => number; recipient?: string; priceLuna?: number; minimumConfirmations?: number } = {}): AtlasOrderStore {
  const now = options.now ?? Date.now;
  const catalog = { recipient: options.recipient ?? LAST_LANTERN.recipient, priceLuna: options.priceLuna ?? LAST_LANTERN.priceLuna };
  const minimumConfirmations = options.minimumConfirmations ?? LAST_LANTERN.minimumConfirmations;
  const orders = new Map<string, AtlasOrder>();
  const idempotency = new Map<string, { fingerprint: string; orderId: string }>();
  let sequence = 0;
  return {
    async create(input) {
      assertExactLantern(input, catalog);
      if (!input.actorId || !input.walletAddress) throw new Error('Atlas order actor and wallet are required.');
      const fingerprint = JSON.stringify([input.actorId, input.walletAddress, input.itemId, input.network, input.recipient, input.valueLuna]);
      if (input.idempotencyKey !== undefined) {
        assertIdempotencyKey(input.idempotencyKey);
        const existing = idempotency.get(input.idempotencyKey);
        if (existing) {
          if (existing.fingerprint !== fingerprint) throw new Error('Atlas order idempotency key is bound to different order fields.');
          return clone(requireOrder(orders, existing.orderId));
        }
      }
      const order: AtlasOrder = {
        id: `atlas-order-${++sequence}`,
        actorId: input.actorId,
        walletAddress: input.walletAddress,
        itemId: input.itemId,
        network: input.network,
        recipient: input.recipient,
        valueLuna: input.valueLuna,
        status: 'created',
        lookup: null,
        failureReason: null,
        fulfilledAt: null,
      };
      orders.set(order.id, order);
      if (input.idempotencyKey !== undefined) idempotency.set(input.idempotencyKey, { fingerprint, orderId: order.id });
      return clone(order);
    },
    async get(orderId) {
      return clone(requireOrder(orders, orderId));
    },
    async submitLookup(orderId, lookup) {
      const order = requireOrder(orders, orderId);
      if (!/^[A-Za-z0-9._:-]{1,256}$/.test(lookup)) throw new Error('Atlas provider lookup is malformed.');
      if (order.status === 'fulfilled' || order.status === 'cancelled') throw new Error(`Atlas order is terminal: ${order.status}.`);
      if (order.status === 'submitted' || order.status === 'confirming') {
        if (order.lookup === lookup) return clone(order);
        throw new Error('Atlas order already has a different provider lookup.');
      }
      order.lookup = lookup;
      order.status = 'submitted';
      return clone(order);
    },
    async reconcile(orderId, evidence) {
      const order = requireOrder(orders, orderId);
      if (order.status === 'fulfilled') return clone(order);
      if (order.status === 'cancelled') throw new Error('Cancelled Atlas orders cannot be fulfilled.');
      if (order.lookup !== evidence.lookup) throw new Error('Atlas chain evidence lookup does not match the order.');
      if (evidence.network !== order.network) throw new Error('Atlas chain evidence network does not match the order.');
      if (evidence.sender !== order.walletAddress) throw new Error('Atlas chain evidence wallet does not match the order.');
      if (evidence.recipient !== order.recipient) throw new Error('Atlas chain evidence recipient does not match the order.');
      if (evidence.valueLuna !== order.valueLuna) throw new Error('Atlas chain evidence Luna value does not match the order.');
      if (!evidence.canonical || !evidence.success) throw new Error('Atlas chain evidence is not canonical and successful.');
      if (!Number.isSafeInteger(evidence.confirmations) || evidence.confirmations < minimumConfirmations) {
        order.status = 'confirming';
        throw new Error('Atlas order is still confirming.');
      }
      order.status = 'fulfilled';
      order.fulfilledAt = now();
      return clone(order);
    },
    async cancel(orderId, reason) {
      const order = requireOrder(orders, orderId);
      if (order.status === 'fulfilled') throw new Error('Fulfilled Atlas orders cannot be cancelled.');
      if (order.status === 'cancelled') return clone(order);
      order.status = 'cancelled';
      order.failureReason = reason.slice(0, 160);
      return clone(order);
    },
  };
}

function assertExactLantern(input: { itemId: string; network: string; recipient: string; valueLuna: number }, catalog: { recipient: string; priceLuna: number }): void {
  if (input.itemId !== LAST_LANTERN.request.itemId || input.network !== LAST_LANTERN.request.network || input.recipient !== catalog.recipient || input.valueLuna !== catalog.priceLuna) {
    throw new Error('Atlas order does not match the approved lantern catalog.');
  }
}

function requireOrder(orders: Map<string, AtlasOrder>, orderId: string): AtlasOrder {
  const order = orders.get(orderId);
  if (!order) throw new Error('Atlas order was not found.');
  return order;
}

function clone(order: AtlasOrder): AtlasOrder {
  return { ...order };
}

function assertIdempotencyKey(value: string): void {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(value)) throw new Error('Atlas order idempotency key is malformed.');
}
