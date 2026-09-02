import { describe, expect, it, vi } from 'vitest';

import { createAtlasApiClient } from '../src/atlas/api';

describe('NIM Atlas order API client', () => {
  it('creates an order and submits only the provider lookup', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      if (init?.method === 'POST' && String(_input).endsWith('/atlas/api/orders')) {
        return new Response(JSON.stringify({ ok: true, data: { id: 'order-1', status: 'created' } }), { status: 201 });
      }
      if (init?.method === 'POST' && String(_input).endsWith('/cancel')) {
        return new Response(JSON.stringify({ ok: true, data: { id: 'order-1', status: 'cancelled' } }));
      }
      return new Response(JSON.stringify({ ok: true, data: { id: 'order-1', status: 'submitted', lookup: 'lookup-1' } }));
    });
    const api = createAtlasApiClient({ baseUrl: 'https://atlas.test', fetchImpl });

    await expect(api.createOrder({ actorId: 'actor-1', walletAddress: 'NQWALLET', itemId: 'harbor-lantern' })).resolves.toEqual({ id: 'order-1', status: 'created' });
    await expect(api.submitTransactionLookup('order-1', 'lookup-1')).resolves.toEqual({ id: 'order-1', status: 'submitted', lookup: 'lookup-1' });
    await expect(api.cancelOrder('order-1', 'wallet-cancelled')).resolves.toEqual({ id: 'order-1', status: 'cancelled' });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toEqual({ actorId: 'actor-1', walletAddress: 'NQWALLET', itemId: 'harbor-lantern' });
  });

  it('returns a safe API error for offline or malformed responses', async () => {
    const api = createAtlasApiClient({ baseUrl: 'https://atlas.test', fetchImpl: vi.fn(async () => new Response('not-json', { status: 503 })) });
    await expect(api.getOrder('order-1')).rejects.toThrow('Atlas service is unavailable.');
  });

  it('reads capability and Beacon status without inventing competitive state', async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      if (String(input).endsWith('/bootstrap')) {
        return new Response(JSON.stringify({ ok: true, data: { product: 'nim-atlas', campaignMode: 'local-first', competitiveExpeditions: false, walletRequired: false, curriculumVersion: 1 } }));
      }
      return new Response(JSON.stringify({ ok: true, data: { status: 'unavailable', verifiedContributorCount: 0, systems: [] } }));
    });
    const api = createAtlasApiClient({ baseUrl: 'https://atlas.test', fetchImpl });

    await expect(api.getBootstrap()).resolves.toMatchObject({ product: 'nim-atlas', competitiveExpeditions: false });
    await expect(api.getBeacon()).resolves.toEqual({ status: 'unavailable', verifiedContributorCount: 0, systems: [] });
  });

  it('reads verified community echoes with an honest status', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, data: { status: 'stale', echoes: [{ id: 'echo-1', districtId: 'pay-harbor', action: 'repair', cosmeticId: 'pay-harbor-repair-mark', displayName: 'Explorer #abcd', contributionDelta: 4, observedAtBucket: 2 }] } })));
    const api = createAtlasApiClient({ baseUrl: 'https://atlas.test', fetchImpl });
    await expect(api.getEchoes()).resolves.toMatchObject({ status: 'stale', echoes: [{ contributionDelta: 4 }] });
  });

  it('reads role-separated competition summaries without fabricating a reward state', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, data: [{ role: 'explorer', bestVerifiedScore: null, eligibility: 'not-verified', dailyObligation: { status: 'estimating', amountLuna: null } }] })));
    const api = createAtlasApiClient({ baseUrl: 'https://atlas.test', fetchImpl });
    await expect(api.getCompetition()).resolves.toEqual([{ role: 'explorer', bestVerifiedScore: null, eligibility: 'not-verified', dailyObligation: { status: 'estimating', amountLuna: null } }]);
  });
});
