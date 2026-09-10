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

/*
 * Network verification. The reader used to stamp observation.network with
 * whatever the caller configured, without ever asking the RPC which chain it
 * was on. orders.reconcile() then compared evidence.network against
 * order.network, but both were copies of the same configured string, so a
 * deployment that pointed a mainnet config at a testnet RPC passed every guard
 * while settling real money on practice evidence.
 *
 * The fingerprint is the genesis block, fetched with getBlockByNumber [0,
 * false]. Its hash is network specific and constant, and the operator can
 * check the expected value against a block explorer. The hashes are supplied
 * by configuration rather than hardcoded here, because inventing a genesis
 * hash would be exactly the unverified assertion this guards against.
 */
describe('NIM Atlas chain reader network verification', () => {
  const transaction = {
    hash: 'lookup-1', blockHeight: 41, sender: 'NQFROM', recipient: 'NQTO', value: 100_000,
    success: true, canonical: true, confirmations: 9,
  };

  function readerWith(genesisHash: string | undefined, actualGenesis: string) {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method: string };
      calls.push(body.method);
      if (body.method === 'getBlockByNumber') return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { number: 0, hash: actualGenesis } }));
      if (body.method === 'getTransactionByHash') return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: transaction }));
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { number: 60 } }));
    });
    const reader = createAtlasChainReader({
      network: 'mainalbatross', rpcUrls: ['https://rpc.test'], minConfirmations: 3, fetchImpl,
      expectedGenesisHash: genesisHash,
    });
    return { reader, calls, fetchImpl };
  }

  it('yields no evidence when the RPC is on a different chain than configured', async () => {
    const { reader, calls } = readerWith('aaaa-main-genesis', 'bbbb-test-genesis');
    await expect(reader.observe('lookup-1')).resolves.toBeNull();
    expect(reader.networkVerification()).toBe('rejected');
    expect(calls, 'the transaction was fetched despite a failed network check').not.toContain('getTransactionByHash');
  });

  it('observes normally once the genesis hash matches', async () => {
    const { reader } = readerWith('aaaa-main-genesis', 'aaaa-main-genesis');
    await expect(reader.observe('lookup-1')).resolves.toMatchObject({ lookup: 'lookup-1', network: 'mainalbatross', confirmations: 9 });
    expect(reader.networkVerification()).toBe('verified');
  });

  it('checks genesis once rather than on every observation', async () => {
    const { reader, calls } = readerWith('aaaa-main-genesis', 'aaaa-main-genesis');
    await reader.observe('lookup-1');
    await reader.observe('lookup-1');
    await reader.observe('lookup-1');
    expect(calls.filter((method) => method === 'getBlockByNumber')).toHaveLength(1);
  });

  it('compares the genesis hash without case sensitivity', async () => {
    const { reader } = readerWith('AAAA-MAIN-GENESIS', 'aaaa-main-genesis');
    await expect(reader.observe('lookup-1')).resolves.toMatchObject({ lookup: 'lookup-1' });
  });

  it('stays unconfigured, and permissive, when no genesis hash is supplied', async () => {
    const { reader, calls } = readerWith(undefined, 'anything');
    await expect(reader.observe('lookup-1')).resolves.toMatchObject({ lookup: 'lookup-1' });
    expect(reader.networkVerification()).toBe('unconfigured');
    expect(calls).not.toContain('getBlockByNumber');
  });

  it('withholds evidence but stays retryable when the genesis fetch fails', async () => {
    let failGenesis = true;
    const fetchImpl = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method: string };
      if (body.method === 'getBlockByNumber') {
        if (failGenesis) return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -1 } }));
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { number: 0, hash: 'aaaa' } }));
      }
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: transaction }));
    });
    const reader = createAtlasChainReader({
      network: 'mainalbatross', rpcUrls: ['https://rpc.test'], minConfirmations: 3, fetchImpl,
      expectedGenesisHash: 'aaaa',
    });

    // A transient RPC failure is not evidence of a wrong chain, so it must not
    // latch a rejection the way a real mismatch does.
    await expect(reader.observe('lookup-1')).resolves.toBeNull();
    expect(reader.networkVerification()).toBe('unchecked');
    failGenesis = false;
    await expect(reader.observe('lookup-1')).resolves.toMatchObject({ lookup: 'lookup-1' });
    expect(reader.networkVerification()).toBe('verified');
  });
});
