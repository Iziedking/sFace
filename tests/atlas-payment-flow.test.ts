import { describe, expect, it, vi } from 'vitest';

import { executeAtlasPayment } from '../src/atlas/payment-flow';

describe('NIM Atlas mobile payment flow', () => {
  it('creates the order before the exact wallet request and submits only the provider lookup', async () => {
    const events: string[] = [];
    const wallet = {
      initialize: vi.fn(async () => {
        events.push('initialize');
        return { ok: true as const, provider: { listAccounts: async () => [], sendBasicTransaction: async () => '' } };
      }),
      requestAccounts: vi.fn(async () => {
        events.push('accounts');
        return ['NQwallet'];
      }),
      sendBasicPayment: vi.fn(async (input: { recipient: string; valueLuna: number }) => {
        events.push(`send:${input.recipient}:${input.valueLuna}`);
        return { kind: 'lookup' as const, value: 'provider-lookup-1' };
      }),
    };
    const api = {
      createOrder: vi.fn(async () => {
        events.push('create-order');
        return { id: 'order-1', status: 'created' };
      }),
      submitTransactionLookup: vi.fn(async () => {
        events.push('submit-lookup');
        return { id: 'order-1', status: 'submitted', lookup: 'provider-lookup-1' };
      }),
      getOrder: vi.fn(),
      cancelOrder: vi.fn(async () => {
        events.push('cancel-order');
        return { id: 'order-1', status: 'cancelled' };
      }),
    };

    await expect(executeAtlasPayment({
      actorId: 'actor-1',
      itemId: 'harbor-lantern',
      recipient: 'NQmerchant',
      valueLuna: 100_000,
      idempotencyKey: 'mobile-order-1',
      wallet,
      api,
    })).resolves.toMatchObject({
      walletAddress: 'NQwallet',
      lookup: 'provider-lookup-1',
      paymentVerified: false,
      order: { id: 'order-1', status: 'submitted' },
    });

    expect(events).toEqual(['initialize', 'accounts', 'create-order', 'send:NQmerchant:100000', 'submit-lookup']);
    expect(api.createOrder).toHaveBeenCalledWith({ actorId: 'actor-1', walletAddress: 'NQwallet', itemId: 'harbor-lantern', idempotencyKey: 'mobile-order-1' });
    expect(wallet.sendBasicPayment).toHaveBeenCalledWith({ recipient: 'NQmerchant', valueLuna: 100_000 });
    expect(api.submitTransactionLookup).toHaveBeenCalledWith('order-1', 'provider-lookup-1');
  });

  it('fails closed when Nimiq Pay is unavailable and never creates an order', async () => {
    const wallet = {
      initialize: vi.fn(async () => ({ ok: false as const, reason: 'unavailable' as const })),
      requestAccounts: vi.fn(),
      sendBasicPayment: vi.fn(),
    };
    const api = { createOrder: vi.fn(), submitTransactionLookup: vi.fn(), getOrder: vi.fn(), cancelOrder: vi.fn() };

    await expect(executeAtlasPayment({ actorId: 'actor-1', itemId: 'harbor-lantern', recipient: 'NQmerchant', valueLuna: 100_000, wallet, api }))
      .rejects.toMatchObject({ stage: 'initializing' });
    expect(api.createOrder).not.toHaveBeenCalled();
    expect(wallet.requestAccounts).not.toHaveBeenCalled();
  });

  it('rejects local fixtures before wallet access and cancels a created order after player cancellation', async () => {
    const wallet = {
      initialize: vi.fn(async () => ({ ok: true as const, provider: { listAccounts: async () => [], sendBasicTransaction: async () => '' } })),
      requestAccounts: vi.fn(async () => ['NQwallet']),
      sendBasicPayment: vi.fn(async () => { throw new Error('User cancelled the Nimiq Pay prompt.'); }),
    };
    const api = {
      createOrder: vi.fn(async () => ({ id: 'order-1', status: 'created' })),
      submitTransactionLookup: vi.fn(),
      getOrder: vi.fn(),
      cancelOrder: vi.fn(async () => ({ id: 'order-1', status: 'cancelled' })),
    };

    await expect(executeAtlasPayment({ actorId: 'actor-1', itemId: 'harbor-lantern', recipient: 'NQATLASLANTERNSHOP', valueLuna: 100_000, wallet, api }))
      .rejects.toMatchObject({ stage: 'review' });
    expect(wallet.initialize).not.toHaveBeenCalled();

    await expect(executeAtlasPayment({ actorId: 'actor-1', itemId: 'harbor-lantern', recipient: 'NQmerchant', valueLuna: 100_000, wallet, api }))
      .rejects.toMatchObject({ stage: 'authorizing' });
    expect(api.cancelOrder).toHaveBeenCalledWith('order-1', 'wallet-cancelled');
    expect(api.submitTransactionLookup).not.toHaveBeenCalled();
  });
});
