import { describe, expect, it } from 'vitest';

import { createPayHarborScene } from '../src/atlas/scenes/pay-harbor';

describe('Pay Harbor visible restoration scene', () => {
  it('separates waiting, confirmation, and restored world projections', () => {
    const waiting = createPayHarborScene({ restoration: 'waiting', reducedMotion: false });
    const confirming = createPayHarborScene({ restoration: 'confirming', reducedMotion: false });
    const restored = createPayHarborScene({ restoration: 'restored', reducedMotion: false });

    expect(waiting.market.stallsOpen).toBe(false);
    expect(waiting.ferrySchedule).toBe('moored');
    expect(waiting.towerLit).toBe(false);
    expect(waiting.routeAccess).toBe('closed');
    expect(confirming.market.stallsOpen).toBe(false);
    expect(confirming.ferrySchedule).toBe('moored');
    expect(confirming.towerLit).toBe(false);
    expect(confirming.routeAccess).toBe('verification');
    expect(confirming.audioLayers).toContain('payment-pending');
    expect(restored.market.stallsOpen).toBe(true);
    expect(restored.ferrySchedule).toBe('running');
    expect(restored.towerLit).toBe(true);
    expect(restored.residentSchedule).toBe('market-open');
    expect(restored.routeAccess).toBe('open');
    expect(restored.audioLayers).toContain('harbor-restored-ambience');
  });

  it('keeps lookup confirmation from activating restoration effects or targets', () => {
    const confirming = createPayHarborScene({ restoration: 'confirming', reducedMotion: false });
    expect(confirming.restorationEffects).toEqual({ market: false, ferry: false, tower: false, paths: false });
    expect(confirming.interactionTargets).toContain('confirmation-station');
    expect(confirming.interactionTargets).not.toContain('harbor-ferry');
    expect(confirming.interactionTargets).not.toContain('lantern-light');
  });

  it('orders active entities by integer projection and keeps reduced motion stateful', () => {
    const moving = createPayHarborScene({ restoration: 'restored', reducedMotion: false });
    const still = createPayHarborScene({ restoration: 'restored', reducedMotion: true });
    expect(moving.entityOrder).toEqual([...moving.entityOrder].sort((left, right) => left.depthKey - right.depthKey || left.id.localeCompare(right.id)));
    expect(moving.ambientMotionEnabled).toBe(true);
    expect(still.ambientMotionEnabled).toBe(false);
    expect(still.towerLit).toBe(true);
  });
});
