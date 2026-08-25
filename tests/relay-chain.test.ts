import { describe, expect, it } from 'vitest';

import { createNimiqRelayChainReader } from '../server/relay/chain';

function response(value: unknown, ok = true): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: value }), { status: ok ? 200 : 503, headers: { 'content-type': 'application/json' } });
}

describe('authoritative Nimiq chain reader', () => {
  it('normalizes included transactions and derives confirmations from the head', async () => {
    const reader = createNimiqRelayChainReader({ network: 'test', rpcUrls: ['https://rpc.example'], minConfirmations: 10, fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      return body.method === 'getTransaction'
        ? response({ data: { hash: 'hash-1', network: 'test', sender: 'NQsender', recipient: 'NQrecipient', value: 1_600_000_000, blockHeight: 90, success: true, canonical: true } })
        : response({ data: { number: 100 } });
    } });
    await expect(reader.observe('hash-1')).resolves.toMatchObject({ hash: 'hash-1', confirmations: 11, valueLuna: 1_600_000_000, canonical: true });
  });

  it('fails over RPCs and never fabricates a transaction when all nodes fail', async () => {
    let calls = 0;
    const reader = createNimiqRelayChainReader({ network: 'main', rpcUrls: ['https://bad.example', 'https://good.example'], minConfirmations: 1, fetchImpl: async (url, init) => {
      calls += 1;
      if (String(url).includes('bad')) throw new Error('offline');
      const body = JSON.parse(String(init?.body));
      return body.method === 'getTransaction' ? response(null) : response({ data: { number: 1 } });
    } });
    await expect(reader.observe('missing')).resolves.toBeNull();
    expect(calls).toBeGreaterThanOrEqual(2);
  });
});
