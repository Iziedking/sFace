import { describe, expect, it, vi } from 'vitest';
import { detectThreeCapability } from '../src/atlas/render/three/capability';

describe('Three renderer capability', () => {
  it('rejects a browser without WebGL 2', () => {
    const canvas = {
      getContext: vi.fn().mockReturnValue(null),
    } as unknown as HTMLCanvasElement;
    expect(detectThreeCapability(canvas)).toEqual({
      supported: false,
      reason: 'webgl2-unavailable',
    });
  });

  it('rejects a device with a small texture limit', () => {
    const canvas = {
      getContext: vi.fn().mockReturnValue({
        getParameter: vi.fn().mockReturnValue(1024),
      }),
    } as unknown as HTMLCanvasElement;
    expect(detectThreeCapability(canvas)).toEqual({
      supported: false,
      reason: 'texture-limit-too-small',
    });
  });

  it('accepts WebGL 2 with the minimum texture limit', () => {
    const canvas = {
      getContext: vi.fn().mockReturnValue({
        getParameter: vi.fn().mockReturnValue(2048),
      }),
    } as unknown as HTMLCanvasElement;
    expect(detectThreeCapability(canvas)).toEqual({
      supported: true,
      maxTextureSize: 2048,
    });
  });
});
