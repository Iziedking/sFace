import { describe, expect, it } from 'vitest';
import {
  QUALITY_PROFILES,
  createQualityGovernor,
  QUALITY_REDUCTION_ORDER,
} from '../shared/atlas/city/quality';

describe('mobile quality policy', () => {
  it('uses the approved population and render scales', () => {
    expect(QUALITY_PROFILES.low).toMatchObject({
      visibleNpcs: 8,
      activeNpcs: 4,
      renderScale: 0.7,
    });
    expect(QUALITY_PROFILES.balanced).toMatchObject({
      visibleNpcs: 12,
      activeNpcs: 6,
      renderScale: 0.85,
    });
    expect(QUALITY_PROFILES.high).toMatchObject({
      visibleNpcs: 17,
      activeNpcs: 10,
      renderScale: 1,
    });
    expect(QUALITY_REDUCTION_ORDER).toEqual([
      'particles',
      'shadows',
      'far-npc-lod',
      'far-animation-rate',
      'render-scale',
    ]);
  });

  it('steps down after five slow seconds and up after thirty stable seconds', () => {
    const governor = createQualityGovernor('high');
    for (let second = 0; second < 5; second += 1) governor.sample(38);
    expect(governor.current()).toBe('balanced');
    for (let second = 0; second < 30; second += 1) governor.sample(25);
    expect(governor.current()).toBe('high');
  });

  it('keeps manual low mode from auto-upgrading', () => {
    const governor = createQualityGovernor('high');
    governor.setManualTier('low');
    for (let second = 0; second < 60; second += 1) governor.sample(16);
    expect(governor.current()).toBe('low');
  });
});
