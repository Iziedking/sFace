import { describe, expect, it } from 'vitest';

import { updateRelayRunHud } from '../src/relay/run-hud';

describe('Relay run HUD stability', () => {
  it('patches live text nodes without replacing semantic controls', () => {
    const controls = { identity: 'same-controls' };
    const values = new Map<string, { textContent: string | null }>([
      ['[data-relay-stat="time"]', { textContent: '' }],
      ['[data-relay-stat="integrity"]', { textContent: '' }],
      ['[data-relay-stat="carried"]', { textContent: '' }],
      ['[data-relay-stat="banked"]', { textContent: '' }],
      ['[data-relay-objective]', { textContent: '' }],
    ]);
    const root = {
      querySelector(selector: string): { textContent: string | null } | null {
        return values.get(selector) ?? null;
      },
      controls,
    };

    updateRelayRunHud(root, { score: 20, integrity: 2, carried: 1, banked: 3, seconds: 4.5 });

    expect(values.get('[data-relay-stat="time"]')?.textContent).toBe('4.5s');
    expect(values.get('[data-relay-stat="integrity"]')?.textContent).toBe('2/3');
    expect(values.get('[data-relay-objective]')?.textContent).toContain('Cross an orange gate');
    expect(root.controls).toBe(controls);
  });
});
