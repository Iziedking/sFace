import { performance } from 'node:perf_hooks';

import { describe, expect, it } from 'vitest';

import { createAtlasDailyService } from '../server/atlas/daily';
import { createAtlasLeaderboardService } from '../server/atlas/leaderboard';
import { createAtlasShopStore } from '../server/atlas/shop';
import { ATLAS_LOCAL_TEST_SHOP_ITEM, applyAtlasShopFulfillment } from '../shared/atlas/shop';
import { createAtlasPlayerProgress } from '../shared/atlas/roles';
import { replayAtlasActions } from '../shared/atlas/replay';
import { ATLAS_CORE_FIXTURE } from '../shared/atlas/world';

const replayActions = Array.from({ length: 1_350 }, () => ({ moveX: 0, moveY: 0, tool: 'none' as const, interact: false }));
const replayRun = () => replayAtlasActions(ATLAS_CORE_FIXTURE, replayActions);

describe('NIM Atlas performance and duplicate-request boundaries', () => {
  it('keeps the recorded 1,350-tick replay below the local p95 budget', () => {
    const durations: number[] = [];
    for (let run = 0; run < 30; run += 1) {
      const started = performance.now();
      replayRun();
      durations.push(performance.now() - started);
    }
    durations.sort((left, right) => left - right);
    expect(durations[Math.floor(durations.length * 0.95)]).toBeLessThan(100);
  });

  it('accepts one effect for 100 concurrent duplicate run, daily, order, and fulfillment requests', async () => {
    const replayHash = 'a'.repeat(64);
    const run = { runId: 'run-concurrent', actorId: 'actor-concurrent', walletAddress: 'NQLOCALWALLET', role: 'explorer' as const, seasonId: 'season-local', score: 100, assistance: 'none' as const, prizeEligible: true, replayHash };
    const leaderboard = createAtlasLeaderboardService();
    const acceptedRuns = await Promise.all(Array.from({ length: 100 }, () => leaderboard.accept(run)));
    expect(new Set(acceptedRuns.map((item) => item.runId))).toEqual(new Set([run.runId]));
    expect(await leaderboard.list(run.seasonId, run.role)).toHaveLength(1);

    const daily = createAtlasDailyService({ date: () => '2026-08-25' });
    const dailyInput = { actorId: run.actorId, walletAddress: run.walletAddress, challengeId: 'daily-01', answer: '1200000', replayComplete: true, assistance: 'none' as const };
    const dailyResults = await Promise.all(Array.from({ length: 100 }, () => daily.submit(dailyInput)));
    expect(dailyResults.filter((item) => item.accepted && !item.duplicate)).toHaveLength(1);
    expect(dailyResults.filter((item) => item.duplicate)).toHaveLength(99);

    const item = ATLAS_LOCAL_TEST_SHOP_ITEM;
    const store = createAtlasShopStore({ catalog: [item], mode: 'local', now: () => 100 });
    const orderInput = { actorId: run.actorId, walletAddress: run.walletAddress, itemId: item.id, network: item.network, recipient: item.recipient!, valueLuna: item.priceLuna, idempotencyKey: 'local-order-once' };
    const orders = await Promise.all(Array.from({ length: 100 }, () => store.create(orderInput)));
    expect(new Set(orders.map((order) => order.id))).toHaveLength(1);
    await expect(store.create({ ...orderInput, walletAddress: 'NQSUBSTITUTED' })).rejects.toThrow(/idempotency|different|wallet/i);
    const order = orders[0]!;
    const lookup = 'local-concurrent-hash';
    await Promise.all(Array.from({ length: 100 }, () => store.submitLookup(order.id, lookup)));
    const evidence = { lookup, network: item.network, sender: run.walletAddress, recipient: item.recipient!, valueLuna: item.priceLuna, canonical: true, success: true, confirmations: 3, reorgDetected: false };
    const fulfilled = await Promise.all(Array.from({ length: 100 }, () => store.reconcile(order.id, evidence)));
    expect(new Set(fulfilled.map((result) => result.fulfilledAt))).toEqual(new Set([100]));

    let progress = createAtlasPlayerProgress();
    for (let count = 0; count < 100; count += 1) progress = applyAtlasShopFulfillment(progress, item);
    expect(progress.inventoryItemIds.filter((id) => id === item.id)).toHaveLength(1);
  });
});
