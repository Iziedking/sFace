import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { ATLAS_PROLOGUE } from '../shared/atlas/prologue';
import { createAtlasState } from '../shared/atlas/state';
import { stepAtlas } from '../shared/atlas/step';
import { ATLAS_CORE_FIXTURE } from '../shared/atlas/world';

describe('NIM Atlas human prologue', () => {
  it('keeps the former Courier Ada prototype in history while opening with an ordinary human need', () => {
    const history = readFileSync(new URL('../shared/atlas/history/genesis-garden-courier-ada.ts', import.meta.url), 'utf8');
    expect(history).toContain('courier-ada');
    expect(ATLAS_PROLOGUE.guide.name).toBe('Mara');
    expect(ATLAS_PROLOGUE.guide.need).toMatch(/harbor|lantern|route/i);
    expect(ATLAS_PROLOGUE.nextDestination.label).toBe('Pay Harbor');
  });

  it('exposes two human paths without changing the shared destination', () => {
    expect(ATLAS_PROLOGUE.roles.map((role) => role.id)).toEqual(['explorer', 'builder']);
    expect(ATLAS_PROLOGUE.roles[0]!.description).toMatch(/shop|payment/i);
    expect(ATLAS_PROLOGUE.roles[1]!.description).toMatch(/repair|provider/i);
    expect(ATLAS_PROLOGUE.roles[0]!.nextDestination).toBe(ATLAS_PROLOGUE.roles[1]!.nextDestination);
  });

  it('tracks a clear facing direction in the DOM-free character state', () => {
    const state = createAtlasState(ATLAS_CORE_FIXTURE);
    expect(state.player.facing).toBe('right');
    stepAtlas(state, { moveX: 0, moveY: 127, tool: 'none', interact: false });
    expect(state.player.facing).toBe('down');
  });
});
