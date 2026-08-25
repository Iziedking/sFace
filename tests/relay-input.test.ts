import { describe, expect, it } from 'vitest';

import { mapTouchToSteer } from '../src/relay/input/touch';
import { RelayInputSampler } from '../src/relay/input/sampler';

describe('Relay input sampler', () => {
  it('maps touch position to the shared -127..127 steering range', () => {
    expect(mapTouchToSteer(0, 100)).toBe(-127);
    expect(mapTouchToSteer(50, 100)).toBe(0);
    expect(mapTouchToSteer(100, 100)).toBe(127);
    expect(mapTouchToSteer(200, 100)).toBe(127);
  });

  it('normalizes touch and keyboard targets through one integer sampler', () => {
    const sampler = new RelayInputSampler();
    sampler.setTouchSteer(90);
    expect(sampler.sample()).toBe(90);
    sampler.setKeyboardSteer(-200);
    expect(sampler.sample()).toBe(-127);
    sampler.clearKeyboardSteer();
    expect(sampler.sample()).toBe(90);
  });
});
