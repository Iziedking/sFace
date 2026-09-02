import { describe, expect, it } from 'vitest';
import express from 'express';

import { createAtlasApi } from '../server/atlas/routes';
import { ATLAS_CURRICULUM } from '../shared/atlas/manifest';
import { createAtlasBeaconRepository, createAtlasBeaconService } from '../server/atlas/beacon';
import { createAtlasOrderStore } from '../server/atlas/orders';
import { mountAtlasRoutes } from '../server/atlas/routes';
import { createAtlasEchoRepository, createAtlasEchoService } from '../server/atlas/echoes';

describe('NIM Atlas public curriculum boundary', () => {
  it('serves an honest local-first bootstrap and validated curriculum', async () => {
    const api = createAtlasApi({ curriculum: ATLAS_CURRICULUM, now: () => new Date('2026-08-25T12:00:00.000Z') });
    await expect(api.bootstrap()).resolves.toEqual({
      product: 'nim-atlas',
      campaignMode: 'local-first',
      competitiveExpeditions: false,
      walletRequired: false,
      curriculumVersion: 1,
    });
    const curriculum = await api.curriculum();
    expect(curriculum.version).toBe(1);
    expect(curriculum.districts[0]?.id).toBe('genesis-garden');
    expect(curriculum.finale.id).toBe('beacon-core');
  });

  it('refuses to boot with malformed or stale curriculum', () => {
    const malformed = structuredClone(ATLAS_CURRICULUM) as unknown as { districts: unknown[] };
    malformed.districts = [];
    expect(() => createAtlasApi({ curriculum: malformed, now: () => new Date('2026-08-25T12:00:00.000Z') })).toThrow();
  });

  it('exposes Beacon status only when the server projection is injected', async () => {
    const beacon = createAtlasBeaconService({ repository: createAtlasBeaconRepository(), now: () => 1_000 });
    const api = createAtlasApi({ curriculum: ATLAS_CURRICULUM, beacon, now: () => new Date('2026-08-25T12:00:00.000Z') });
    await expect(api.beacon?.()).resolves.toMatchObject({ status: 'live', verifiedContributorCount: 0 });
  });

  it('uses the configured live catalog and reconciles only server-observed chain evidence', async () => {
    const recipient = `NQ00${'A'.repeat(32)}`;
    const walletAddress = 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000';
    const orders = createAtlasOrderStore({ recipient, priceLuna: 100_000 });
    const api = createAtlasApi({
      curriculum: ATLAS_CURRICULUM,
      orders,
      orderCatalog: { itemId: 'harbor-lantern', network: 'testalbatross', recipient, valueLuna: 100_000 },
      chain: { observe: async (lookup) => ({ lookup, network: 'testalbatross', blockHeight: 10, confirmations: 3, sender: walletAddress, recipient, valueLuna: 100_000, success: true, canonical: true }) },
    });
    const app = express();
    app.use(express.json());
    mountAtlasRoutes({ app, limit: () => (_request, _response, next) => next(), api });
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => { const listening = app.listen(0, () => resolve(listening)); });
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Test server did not expose a port.');
      const base = `http://127.0.0.1:${address.port}`;
      const invalid = await fetch(`${base}/atlas/api/orders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ actorId: 'actor-invalid', walletAddress: 'NQnot-an-address' }) });
      expect(invalid.status).toBe(400);
      const created = await fetch(`${base}/atlas/api/orders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ actorId: 'actor-1', walletAddress, recipient: 'NQattacker', valueLuna: 1 }) });
      const createdPayload = await created.json() as { data: { id: string; recipient: string; valueLuna: number; actorId?: string; walletAddress?: string; lookup?: string } };
      expect(created.status).toBe(201);
      expect(createdPayload.data).toMatchObject({ recipient, valueLuna: 100_000 });
      expect(createdPayload.data.actorId).toBeUndefined();
      expect(createdPayload.data.walletAddress).toBeUndefined();
      const submitted = await fetch(`${base}/atlas/api/orders/${createdPayload.data.id}/transaction`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lookup: 'lookup-1' }) });
      const submittedPayload = await submitted.json() as { data: { lookup?: string; lookupSubmitted: boolean } };
      expect(submittedPayload.data.lookup).toBeUndefined();
      expect(submittedPayload.data.lookupSubmitted).toBe(true);
      const reconciled = await fetch(`${base}/atlas/api/orders/${createdPayload.data.id}/reconcile`, { method: 'POST' });
      const reconciledPayload = await reconciled.json() as { data: { status: string; actorId?: string; walletAddress?: string; chainEvidence?: { lookup?: string } } };
      expect(reconciled.status).toBe(200);
      expect(reconciledPayload.data.status).toBe('fulfilled');
      expect(reconciledPayload.data.actorId).toBeUndefined();
      expect(reconciledPayload.data.walletAddress).toBeUndefined();
      expect(reconciledPayload.data.chainEvidence?.lookup).toBeUndefined();
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('serves public echoes only from the injected verified projection', async () => {
    const echoes = createAtlasEchoService({ repository: createAtlasEchoRepository(), now: () => 1_000 });
    const api = createAtlasApi({ curriculum: ATLAS_CURRICULUM, echoes, now: () => new Date('2026-08-25T12:00:00.000Z') });
    const app = express();
    mountAtlasRoutes({ app, limit: () => (_request, _response, next) => next(), api });
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => { const listening = app.listen(0, () => resolve(listening)); });
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Test server did not expose a port.');
      const response = await fetch(`http://127.0.0.1:${address.port}/atlas/api/echoes`);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true, data: { status: 'live', echoes: [] } });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
