import { describe, expect, it, vi } from 'vitest';

import { createAtlasChainReader } from '../server/atlas/chain';

describe('NIM Atlas canonical chain reader', () => {
  it('reads a transaction and computes confirmations from the canonical head', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method: string };
      if (body.method === 'getTransactionByHash') {
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {
          hash: 'lookup-1', blockHeight: 41, sender: 'NQFROM', recipient: 'NQTO', value: 100_000,
          network: 'testalbatross', success: true, canonical: true,
        } }));
      }
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { number: 45 } }));
    });
    const reader = createAtlasChainReader({ network: 'testalbatross', rpcUrls: ['https://rpc.test'], minConfirmations: 3, fetchImpl });

    await expect(reader.observe('lookup-1')).resolves.toEqual({
      lookup: 'lookup-1', network: 'testalbatross', sender: 'NQFROM', recipient: 'NQTO', valueLuna: 100_000,
      success: true, canonical: true, confirmations: 5, blockHeight: 41,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('fails over and never turns an RPC error into payment evidence', async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      if (String(input).includes('bad')) return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -1 } }));
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { data: {
        hash: 'lookup-2', blockHeight: 7, sender: 'NQFROM', recipient: 'NQTO', value: 100_000,
        network: 'testalbatross', success: true, canonical: true, confirmations: 3,
      } } }));
    });
    const reader = createAtlasChainReader({ network: 'testalbatross', rpcUrls: ['https://bad.rpc', 'https://good.rpc'], minConfirmations: 3, fetchImpl });

    await expect(reader.observe('lookup-2')).resolves.toMatchObject({ lookup: 'lookup-2', confirmations: 3 });
    await expect(reader.observe('bad lookup')).resolves.toBeNull();
  });
});
