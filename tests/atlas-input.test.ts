import { describe, expect, it } from 'vitest';

import { AtlasInputController } from '../src/atlas/input';

describe('Atlas semantic controls', () => {
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
});
