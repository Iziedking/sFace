import type { Express, RequestHandler } from 'express';

import { validateAtlasCurriculum } from '../../shared/atlas/curriculum';
import { LAST_LANTERN } from '../../shared/atlas/adventures/last-lantern';
import type { AtlasCurriculum } from '../../shared/atlas/types';
import type { AtlasOrder, AtlasOrderStore } from './orders';
import type { AtlasBeaconService } from './beacon';
import type { AtlasChainReader } from './chain';

export interface AtlasOrderCatalog {
  itemId: 'harbor-lantern';
  network: 'testalbatross';
  recipient: string;
  valueLuna: number;
}

export interface AtlasApi {
  bootstrap(): Promise<{
    product: 'nim-atlas';
    campaignMode: 'local-first';
    competitiveExpeditions: boolean;
    walletRequired: false;
    curriculumVersion: 1;
  }>;
  curriculum(): Promise<AtlasCurriculum>;
  beacon?: () => Promise<Awaited<ReturnType<AtlasBeaconService['read']>>>;
  orders?: AtlasOrderStore;
  orderCatalog?: AtlasOrderCatalog;
  chain?: AtlasChainReader;
}

export function createAtlasApi(options: {
  curriculum: unknown;
  competitiveExpeditions?: boolean;
  now?: () => Date;
  orders?: AtlasOrderStore;
  beacon?: AtlasBeaconService;
  orderCatalog?: AtlasOrderCatalog;
  chain?: AtlasChainReader;
}): AtlasApi {
  const curriculum = validateAtlasCurriculum(options.curriculum, options.now?.() ?? new Date());
  return {
    async bootstrap() {
      return {
        product: 'nim-atlas',
        campaignMode: 'local-first',
        competitiveExpeditions: options.competitiveExpeditions === true,
        walletRequired: false,
        curriculumVersion: curriculum.version,
      };
    },
    async curriculum() {
      return structuredClone(curriculum);
    },
    beacon: options.beacon ? () => options.beacon!.read() : undefined,
    orders: options.orders,
    orderCatalog: options.orderCatalog,
    chain: options.chain,
  };
}

export function mountAtlasRoutes(options: {
  app: Express;
  limit: (maximum: number, refillPerMinute: number) => RequestHandler;
  api: AtlasApi;
}): void {
  options.app.get('/atlas/api/bootstrap', options.limit(120, 40), async (_request, response) => {
    response.setHeader('cache-control', 'no-store');
    response.json({ ok: true, data: await options.api.bootstrap() });
  });
  options.app.get('/atlas/api/curriculum', options.limit(120, 40), async (_request, response) => {
    response.setHeader('cache-control', 'public, max-age=300');
    response.json({ ok: true, data: await options.api.curriculum() });
  });
  options.app.get('/atlas/api/beacon', options.limit(120, 40), async (_request, response) => {
    if (!options.api.beacon) { response.status(503).json({ ok: false, error: 'Atlas Beacon is unavailable.' }); return; }
    response.setHeader('cache-control', 'no-store');
    response.json({ ok: true, data: await options.api.beacon() });
  });
  options.app.post('/atlas/api/orders', options.limit(30, 10), async (request, response) => {
    if (!options.api.orders) { response.status(503).json({ ok: false, error: 'Atlas orders are unavailable.' }); return; }
    try {
      const body = request.body as Partial<AtlasOrder> & { idempotencyKey?: unknown };
      const catalog = options.api.orderCatalog ?? { itemId: 'harbor-lantern' as const, network: 'testalbatross' as const, recipient: LAST_LANTERN.recipient, valueLuna: LAST_LANTERN.priceLuna };
      const order = await options.api.orders.create({
        actorId: requiredString(body.actorId), walletAddress: requiredString(body.walletAddress), itemId: catalog.itemId,
        network: catalog.network, recipient: catalog.recipient, valueLuna: catalog.valueLuna,
        idempotencyKey: body.idempotencyKey === undefined ? undefined : requiredString(body.idempotencyKey),
      });
      response.status(201).json({ ok: true, data: order });
    } catch (error) { response.status(400).json({ ok: false, error: safeError(error) }); }
  });
  options.app.get('/atlas/api/orders/:orderId', options.limit(120, 40), async (request, response) => {
    if (!options.api.orders) { response.status(503).json({ ok: false, error: 'Atlas orders are unavailable.' }); return; }
    try { response.json({ ok: true, data: await options.api.orders.get(request.params.orderId) }); }
    catch { response.status(404).json({ ok: false, error: 'Atlas order was not found.' }); }
  });
  options.app.post('/atlas/api/orders/:orderId/transaction', options.limit(30, 10), async (request, response) => {
    if (!options.api.orders) { response.status(503).json({ ok: false, error: 'Atlas orders are unavailable.' }); return; }
    try { response.json({ ok: true, data: await options.api.orders.submitLookup(request.params.orderId, requiredString((request.body as { lookup?: unknown }).lookup)) }); }
    catch (error) { response.status(400).json({ ok: false, error: safeError(error) }); }
  });
  options.app.post('/atlas/api/orders/:orderId/reconcile', options.limit(30, 10), async (request, response) => {
    if (!options.api.orders || !options.api.chain) { response.status(503).json({ ok: false, error: 'Atlas payment reconciliation is unavailable.' }); return; }
    try {
      const order = await options.api.orders.get(request.params.orderId);
      if (!order.lookup) { response.status(409).json({ ok: false, error: 'Atlas order has no provider lookup.' }); return; }
      const observation = await options.api.chain.observe(order.lookup);
      if (!observation) { response.status(202).json({ ok: true, data: order }); return; }
      const fulfilled = await options.api.orders.reconcile(order.id, {
        lookup: observation.lookup,
        network: observation.network,
        sender: observation.sender,
        recipient: observation.recipient,
        valueLuna: observation.valueLuna,
        canonical: observation.canonical,
        success: observation.success,
        confirmations: observation.confirmations,
      });
      response.json({ ok: true, data: { ...fulfilled, chainEvidence: { lookup: observation.lookup, network: observation.network, recipient: observation.recipient, valueLuna: observation.valueLuna, canonical: observation.canonical, success: observation.success, confirmations: observation.confirmations } } });
    } catch (error) {
      if (safeError(error).toLowerCase().includes('confirm')) {
        try { response.status(202).json({ ok: true, data: await options.api.orders!.get(request.params.orderId) }); } catch { response.status(404).json({ ok: false, error: 'Atlas order was not found.' }); }
        return;
      }
      response.status(400).json({ ok: false, error: safeError(error) });
    }
  });
  options.app.post('/atlas/api/orders/:orderId/cancel', options.limit(30, 10), async (request, response) => {
    if (!options.api.orders) { response.status(503).json({ ok: false, error: 'Atlas orders are unavailable.' }); return; }
    try {
      const reason = requiredString((request.body as { reason?: unknown }).reason);
      response.json({ ok: true, data: await options.api.orders.cancel(request.params.orderId, reason) });
    } catch (error) { response.status(400).json({ ok: false, error: safeError(error) }); }
  });
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) throw new Error('Atlas order field is invalid.');
  return value;
}

function safeError(error: unknown): string { return error instanceof Error ? error.message : 'Atlas request was rejected.'; }
