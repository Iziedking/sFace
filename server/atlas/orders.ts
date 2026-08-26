import { randomUUID } from 'node:crypto';

import { LAST_LANTERN } from '../../shared/atlas/adventures/last-lantern';
import type { AtlasRepository } from './persistence';

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

export interface PublicAtlasOrder {
  id: string;
  itemId: AtlasOrder['itemId'];
  network: AtlasOrder['network'];
  recipient: string;
  valueLuna: number;
  status: AtlasOrderStatus;
  lookupSubmitted: boolean;
  failureReason: string | null;
  fulfilledAt: number | null;
}

interface PersistedAtlasOrders {
  version: 1;
  orders: AtlasOrder[];
  idempotency: Array<[string, { fingerprint: string; orderId: string }]>;
}

const PERSISTENCE_KEY = 'atlas-orders-v1';

export function createAtlasOrderStore(options: { now?: () => number; recipient?: string; priceLuna?: number; minimumConfirmations?: number; repository?: AtlasRepository } = {}): AtlasOrderStore {
  const now = options.now ?? Date.now;
  const catalog = { recipient: options.recipient ?? LAST_LANTERN.recipient, priceLuna: options.priceLuna ?? LAST_LANTERN.priceLuna };
  const minimumConfirmations = options.minimumConfirmations ?? LAST_LANTERN.minimumConfirmations;
  const orders = new Map<string, AtlasOrder>();
  const idempotency = new Map<string, { fingerprint: string; orderId: string }>();
  let hydrated = false;
  let operations: Promise<void> = Promise.resolve();
  return {
    async create(input) {
      return mutate(async () => {
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
          id: `atlas-order-${randomUUID()}`,
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
      });
    },
    async get(orderId) {
      return read(() => clone(requireOrder(orders, orderId)));
    },
    async submitLookup(orderId, lookup) {
      return mutate(async () => {
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
      });
    },
    async reconcile(orderId, evidence) {
      return mutate(async () => {
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
      });
    },
    async cancel(orderId, reason) {
      return mutate(async () => {
        const order = requireOrder(orders, orderId);
        if (order.status === 'fulfilled') throw new Error('Fulfilled Atlas orders cannot be cancelled.');
        if (order.status === 'cancelled') return clone(order);
        if (!['wallet-cancelled', 'wallet-unavailable', 'player-exit'].includes(reason)) throw new Error('Atlas cancellation reason is invalid.');
        order.status = 'cancelled';
        order.failureReason = reason;
        return clone(order);
      });
    },
  };

  function read<T>(operation: () => T): Promise<T> {
    return serialise(async () => operation(), false);
  }

  function mutate<T>(operation: () => Promise<T>): Promise<T> {
    return serialise(operation, true);
  }

  function serialise<T>(operation: () => Promise<T>, persist: boolean): Promise<T> {
    const result = operations.catch(() => undefined).then(async () => {
      await hydrate();
      try {
        return await operation();
      } finally {
        if (persist) await save();
      }
    });
    operations = result.then(() => undefined, () => undefined);
    return result;
  }

  async function hydrate(): Promise<void> {
    if (hydrated) return;
    hydrated = true;
    if (!options.repository) return;
    const loaded = await options.repository.load();
    const record = loaded.snapshot?.records[PERSISTENCE_KEY];
    if (record === undefined) return;
    if (!isPersistedOrders(record)) throw new Error('Atlas persisted order ledger is malformed.');
    orders.clear();
    idempotency.clear();
    for (const order of record.orders) orders.set(order.id, clone(order));
    for (const [key, value] of record.idempotency) idempotency.set(key, { ...value });
  }

  async function save(): Promise<void> {
    if (!options.repository) return;
    const loaded = await options.repository.load();
    const records = { ...(loaded.snapshot?.records ?? {}) };
    records[PERSISTENCE_KEY] = {
      version: 1,
      orders: [...orders.values()].map(clone),
      idempotency: [...idempotency.entries()].map(([key, value]) => [key, { ...value }]),
    } satisfies PersistedAtlasOrders;
    await options.repository.save({ version: 1, updatedAt: now(), records });
  }
}

export function toPublicAtlasOrder(order: AtlasOrder): PublicAtlasOrder {
  return {
    id: order.id,
    itemId: order.itemId,
    network: order.network,
    recipient: order.recipient,
    valueLuna: order.valueLuna,
    status: order.status,
    lookupSubmitted: order.lookup !== null,
    failureReason: order.failureReason,
    fulfilledAt: order.fulfilledAt,
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

function isPersistedOrders(value: unknown): value is PersistedAtlasOrders {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<PersistedAtlasOrders>;
  if (candidate.version !== 1 || !Array.isArray(candidate.orders) || !Array.isArray(candidate.idempotency)) return false;
  const ids = new Set<string>();
  for (const order of candidate.orders) {
    if (!isPersistedOrder(order) || ids.has(order.id)) return false;
    ids.add(order.id);
  }
  return candidate.idempotency.every((entry) => Array.isArray(entry) && entry.length === 2
    && typeof entry[0] === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(entry[0])
    && entry[1] && typeof entry[1] === 'object' && !Array.isArray(entry[1])
    && typeof entry[1].fingerprint === 'string' && entry[1].fingerprint.length > 0 && entry[1].fingerprint.length <= 1024
    && typeof entry[1].orderId === 'string' && ids.has(entry[1].orderId));
}

function isPersistedOrder(value: unknown): value is AtlasOrder {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const order = value as Partial<AtlasOrder>;
  return typeof order.id === 'string' && /^atlas-order-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(order.id)
    && typeof order.actorId === 'string' && order.actorId.length > 0 && order.actorId.length <= 256
    && typeof order.walletAddress === 'string' && order.walletAddress.length > 0 && order.walletAddress.length <= 256
    && order.itemId === 'harbor-lantern' && order.network === 'testalbatross'
    && typeof order.recipient === 'string' && order.recipient.length > 0 && order.recipient.length <= 256
    && typeof order.valueLuna === 'number' && Number.isSafeInteger(order.valueLuna) && order.valueLuna > 0
    && ['created', 'submitted', 'confirming', 'fulfilled', 'cancelled'].includes(order.status ?? '')
    && (order.lookup === null || (typeof order.lookup === 'string' && /^[A-Za-z0-9._:-]{1,256}$/.test(order.lookup)))
    && (order.failureReason === null || ['wallet-cancelled', 'wallet-unavailable', 'player-exit'].includes(order.failureReason ?? ''))
    && (order.fulfilledAt === null || (typeof order.fulfilledAt === 'number' && Number.isSafeInteger(order.fulfilledAt) && order.fulfilledAt >= 0));
}
