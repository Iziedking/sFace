import { describe, expect, it } from 'vitest';

import { AtlasCameraLookController, AtlasInputController, installAtlasKeyboard, shouldHandleDirectionalClick } from '../src/atlas/input';
import type { AtlasAction } from '../shared/atlas/state';

describe('Atlas semantic controls', () => {
  it('turns the camera from a bounded right-thumb drag', () => {
    const look = new AtlasCameraLookController();
    look.begin(7, 120);
    expect(look.move(7, 170)).toBeCloseTo(-0.325);
    expect(look.move(9, 220)).toBe(0);
    expect(look.end(7)).toBe(true);
    expect(look.move(7, 240)).toBe(0);
  });

  it('does not replay a pointer movement as a second click impulse', () => {
    expect(shouldHandleDirectionalClick(1)).toBe(false);
    expect(shouldHandleDirectionalClick(0)).toBe(true);
  });

  it('combines held movement with one-shot tools and interaction', () => {
    const input = new AtlasInputController();
    input.setDirection('right', true);
    input.triggerTool('scanner');
    expect(input.sample()).toEqual({ moveX: 127, moveY: 0, tool: 'scanner', interact: false, system: 'active' });
    expect(input.sample()).toEqual({ moveX: 127, moveY: 0, tool: 'none', interact: false, system: 'active' });
    input.triggerInteract();
    expect(input.sample()).toMatchObject({ moveX: 127, interact: true });
    input.setDirection('right', false);
    input.setSystem('hidden');
    expect(input.sample()).toMatchObject({ moveX: 0, moveY: 0, system: 'hidden' });
  });

  it('converts a destination into bounded integer actions', () => {
    const input = new AtlasInputController();
    input.setDestination({ x: 900, y: 300 });
    expect(input.sampleFor({ x: 100, y: 300 })).toMatchObject({ moveX: 127, moveY: 0 });
  });

  it('stops at the destination dead zone and supports cancellation', () => {
    const input = new AtlasInputController();
    input.setDestination({ x: 120, y: 120 });
    expect(input.sampleFor({ x: 100, y: 100 })).toMatchObject({ moveX: 0, moveY: 0 });
    input.setDestination({ x: 900, y: 100 });
    input.cancelDestination();
    expect(input.sampleFor({ x: 100, y: 100 })).toMatchObject({ moveX: 0, moveY: 0 });
  });

  it('lets held keyboard movement override a destination', () => {
    const input = new AtlasInputController();
    input.setDestination({ x: 100, y: 900 });
    input.setDirection('left', true);
    expect(input.sampleFor({ x: 500, y: 100 })).toMatchObject({ moveX: -127, moveY: 0 });
  });

  it('rejects non-finite destinations and produces repeatable traces', () => {
    const input = new AtlasInputController();
    expect(() => input.setDestination({ x: Number.NaN, y: 0 })).toThrow('finite');
    const trace = (): AtlasAction[] => {
      const controller = new AtlasInputController();
      controller.setDestination({ x: 900, y: 450 });
      return [
        controller.sampleFor({ x: 100, y: 450 }),
        controller.sampleFor({ x: 200, y: 450 }),
        controller.sampleFor({ x: 300, y: 450 }),
      ];
    };
    expect(trace()).toEqual(trace());
  });

  it('supports a bounded thumb joystick and expedition actions', () => {
    const input = new AtlasInputController();
    input.setJoystick({ x: 0.5, y: -1 });
    input.triggerScan();
    input.triggerContextTool('shield-pulse');
    expect(input.sampleExpedition()).toEqual({
      moveX: 64,
      moveY: -127,
      tool: 'shield-pulse',
      interact: false,
      scan: true,
      contextTool: 'shield-pulse',
      system: 'active',
    });
    expect(input.sampleExpedition()).toMatchObject({ moveX: 64, moveY: -127, scan: false, contextTool: 'none', tool: 'none' });
    input.clearJoystick();
    expect(input.sampleExpedition()).toMatchObject({ moveX: 0, moveY: 0 });
  });

  it('uses the thumb joystick in the living city while keyboard input retains priority', () => {
    const input = new AtlasInputController();
    input.setJoystick({ x: 0.4, y: -0.75 });
    expect(input.sample()).toMatchObject({ moveX: 51, moveY: -95 });
    input.setDirection('left', true);
    expect(input.sample()).toMatchObject({ moveX: -127, moveY: 0 });
    input.setDirection('left', false);
    input.clearJoystick();
    expect(input.sample()).toMatchObject({ moveX: 0, moveY: 0 });
  });

  it('rejects non-finite joystick input and preserves keyboard tool parity', () => {
    const input = new AtlasInputController();
    expect(() => input.setJoystick({ x: Number.NaN, y: 0 })).toThrow('finite');
    const listeners = new Map<string, EventListener>();
    const target = {
      addEventListener: (type: string, listener: EventListener) => listeners.set(type, listener),
      removeEventListener: () => undefined,
    } as unknown as Window;
    const cleanup = installAtlasKeyboard(target, input);
    listeners.get('keydown')?.({ key: 'q', repeat: false, preventDefault: () => undefined } as unknown as KeyboardEvent);
    expect(input.sampleExpedition()).toMatchObject({ scan: true, tool: 'scanner', contextTool: 'scanner' });
    cleanup();
  });
});
