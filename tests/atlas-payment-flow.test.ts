import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import { executeAtlasPayment } from '../src/atlas/payment-flow';
import { AtlasPaymentController } from '../src/atlas/app/payment-controller';

const atlasApp = readFileSync(new URL('../src/atlas/app/atlas-app.ts', import.meta.url), 'utf8');

describe('NIM Atlas mobile payment flow', () => {
  it('routes the live browser path through the recoverable payment controller', () => {
    expect(atlasApp).toContain("import { AtlasPaymentController } from './payment-controller';");
    expect(atlasApp).toContain('new AtlasPaymentController');
    expect(atlasApp).not.toContain('executeAtlasPayment({');
  });

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

  it('runs the Explorer boundary in order, verifies canonical evidence, and restores exactly once', async () => {
    const events: string[] = [];
    const wallet = {
      initialize: vi.fn(async () => { events.push('init'); return { ok: true as const, provider: { listAccounts: async () => [], sendBasicTransaction: async () => '' } }; }),
      requestAccounts: vi.fn(async () => { events.push('accounts'); return ['NQwallet']; }),
      sendBasicPayment: vi.fn(async (input: { recipient: string; valueLuna: number }) => { events.push(`send:${input.recipient}:${input.valueLuna}`); return { kind: 'lookup' as const, value: 'lookup-1' }; }),
    };
    const api = {
      createOrder: vi.fn(async () => { events.push('order'); return { id: 'order-1', status: 'created' }; }),
      submitTransactionLookup: vi.fn(async () => { events.push('submit'); return { id: 'order-1', status: 'submitted', lookup: 'lookup-1' }; }),
      reconcileOrder: vi.fn(async () => ({
        id: 'order-1', status: 'fulfilled', lookup: 'lookup-1',
        chainEvidence: { lookup: 'lookup-1', network: 'testalbatross', sender: 'NQwallet', recipient: 'NQmerchant', valueLuna: 100_000, canonical: true, success: true, confirmations: 3 },
      })),
      cancelOrder: vi.fn(async () => ({ id: 'order-1', status: 'cancelled' })),
    };
    const controller = new AtlasPaymentController({
      actorId: 'actor-1', wallet, api,
      request: { itemId: 'harbor-lantern', network: 'testalbatross', recipient: 'NQmerchant', valueLuna: 100_000 },
    });
    expect(controller.state.status).toBe('idle');
    controller.review();
    await expect(controller.start()).resolves.toMatchObject({ status: 'confirming', orderId: 'order-1', lookup: 'lookup-1' });
    expect(events).toEqual(['init', 'accounts', 'order', 'send:NQmerchant:100000', 'submit']);
    await expect(controller.reconcile()).resolves.toMatchObject({ status: 'verified', worldRestored: false });
    expect(controller.fulfill()).toMatchObject({ status: 'fulfilled', worldRestored: true, fulfillmentCount: 1 });
    expect(() => controller.fulfill()).toThrow(/once|duplicate/i);
    expect(wallet.sendBasicPayment).toHaveBeenCalledTimes(1);
  });

  it('cancels before wallet access and requires Builder prediction before observation', async () => {
    const wallet = { initialize: vi.fn(), requestAccounts: vi.fn(), sendBasicPayment: vi.fn() };
    const api = { createOrder: vi.fn(), submitTransactionLookup: vi.fn(), reconcileOrder: vi.fn(), cancelOrder: vi.fn() };
    const controller = new AtlasPaymentController({
      actorId: 'actor-1', wallet, api,
      request: { itemId: 'harbor-lantern', network: 'testalbatross', recipient: 'NQmerchant', valueLuna: 100_000 },
    });
    await expect(controller.cancel('player-exit')).resolves.toMatchObject({ status: 'cancelled' });
    expect(wallet.initialize).not.toHaveBeenCalled();
    expect(() => controller.observeBuilder('provider-ready', 'provider')).toThrow(/predict/i);
    controller.predictBuilder('provider-ready', 'provider');
    expect(controller.observeBuilder('provider-ready', 'provider')).toEqual({ stepId: 'provider-ready', prediction: 'provider', observation: 'provider' });
  });

  it('recovers a submitted order without prompting a second send', async () => {
    const persistence = { save: vi.fn(), load: vi.fn(() => ({ status: 'confirming' as const, orderId: 'order-1', lookup: 'lookup-1', walletAddress: 'NQwallet', error: null, fulfillmentCount: 0, worldRestored: false, builderPredictions: {}, builderObservations: [] })) };
    const wallet = { initialize: vi.fn(), requestAccounts: vi.fn(), sendBasicPayment: vi.fn() };
    const api = {
      createOrder: vi.fn(), submitTransactionLookup: vi.fn(),
      reconcileOrder: vi.fn(async () => ({ id: 'order-1', status: 'confirming', lookup: 'lookup-1' })),
      cancelOrder: vi.fn(),
    };
    const controller = new AtlasPaymentController({
      actorId: 'actor-1', wallet, api,
      request: { itemId: 'harbor-lantern', network: 'testalbatross', recipient: 'NQmerchant', valueLuna: 100_000 },
      persistence,
    });
    expect(controller.state.status).toBe('confirming');
    await expect(controller.reconcile()).resolves.toMatchObject({ status: 'confirming' });
    expect(wallet.sendBasicPayment).not.toHaveBeenCalled();
  });

  it('rejects wallet-substitution evidence and never restores the world', async () => {
    const wallet = { initialize: vi.fn(), requestAccounts: vi.fn(), sendBasicPayment: vi.fn() };
    const api = {
      createOrder: vi.fn(), submitTransactionLookup: vi.fn(),
      reconcileOrder: vi.fn(async () => ({ id: 'order-1', status: 'fulfilled', lookup: 'lookup-1', chainEvidence: { network: 'testalbatross', sender: 'NQwallet', recipient: 'NQsubstituted', valueLuna: 100_000, canonical: true, success: true, confirmations: 3 } })),
      cancelOrder: vi.fn(),
    };
    const controller = new AtlasPaymentController({
      actorId: 'actor-1', wallet, api,
      request: { itemId: 'harbor-lantern', network: 'testalbatross', recipient: 'NQmerchant', valueLuna: 100_000 },
      persistence: { load: () => ({ status: 'confirming', orderId: 'order-1', walletAddress: 'NQwallet', lookup: 'lookup-1', error: null, fulfillmentCount: 0, worldRestored: false, builderPredictions: {}, builderObservations: [] }), save: vi.fn() },
    });
    await expect(controller.reconcile()).resolves.toMatchObject({ status: 'failed', worldRestored: false });
    expect(() => controller.fulfill()).toThrow(/verified/i);
    expect(wallet.sendBasicPayment).not.toHaveBeenCalled();
  });

  it('does not trust forged persisted fulfillment or mismatched lookup evidence', async () => {
    const wallet = { initialize: vi.fn(), requestAccounts: vi.fn(), sendBasicPayment: vi.fn() };
    const api = {
      createOrder: vi.fn(), submitTransactionLookup: vi.fn(),
      reconcileOrder: vi.fn(async () => ({ id: 'order-1', status: 'fulfilled', lookup: 'different-lookup', chainEvidence: { network: 'testalbatross', recipient: 'NQmerchant', valueLuna: 100_000, canonical: true, success: true, confirmations: 3 } })),
      cancelOrder: vi.fn(),
    };
    const controller = new AtlasPaymentController({
      actorId: 'actor-1', wallet, api,
      request: { itemId: 'harbor-lantern', network: 'testalbatross', recipient: 'NQmerchant', valueLuna: 100_000 },
      persistence: { load: () => ({ status: 'fulfilled', orderId: 'order-1', walletAddress: 'NQwallet', lookup: 'lookup-1', error: null, fulfillmentCount: 1, worldRestored: true, builderPredictions: {}, builderObservations: [], evidence: { network: 'testalbatross', recipient: 'NQmerchant', valueLuna: 100_000, canonical: true, success: true, confirmations: 3 } }), save: vi.fn() },
    });
    expect(controller.state).toMatchObject({ status: 'confirming', worldRestored: false, fulfillmentCount: 0 });
    await expect(controller.reconcile()).resolves.toMatchObject({ status: 'failed', worldRestored: false });
    expect(() => controller.fulfill()).toThrow(/verified/i);
  });
});
