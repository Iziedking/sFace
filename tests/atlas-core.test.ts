import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { createAtlasState } from '../shared/atlas/state';
import { replayAtlasActions } from '../shared/atlas/replay';
import { stepAtlas } from '../shared/atlas/step';
import { ATLAS_CORE_FIXTURE } from '../shared/atlas/world';
import type { AtlasAction } from '../shared/atlas/state';
import { ATLAS_LEGACY_REUSE } from '../shared/atlas/legacy-reuse';

const idle = (): AtlasAction => ({ moveX: 0, moveY: 0, tool: 'none', interact: false });

describe('NIM Atlas deterministic adventure core', () => {
  it('uses scanner, tether, rescue, and gate interactions to complete an adventure', () => {
    const state = createAtlasState(ATLAS_CORE_FIXTURE);
    for (let tick = 0; tick < 5; tick += 1) stepAtlas(state, { ...idle(), moveX: 127 });
    stepAtlas(state, { ...idle(), tool: 'scanner' });
    expect(state.relays[0]).toMatchObject({ scanned: true, connected: false });
    stepAtlas(state, { ...idle(), tool: 'relay-tether' });
    expect(state.relays[0]?.connected).toBe(true);
    for (let tick = 0; tick < 10; tick += 1) stepAtlas(state, { ...idle(), moveX: 127 });
    stepAtlas(state, { ...idle(), interact: true });
    expect(state.rescue.rescued).toBe(true);
    for (let tick = 0; tick < 5; tick += 1) stepAtlas(state, { ...idle(), moveX: 127 });
    stepAtlas(state, { ...idle(), interact: true });
    expect(state).toMatchObject({ phase: 'completed', gate: { unlocked: true } });
  });

  it('makes shield pulse prevent a fault hit while an unshielded collision costs integrity', () => {
    const unshielded = createAtlasState(ATLAS_CORE_FIXTURE);
    stepAtlas(unshielded, { ...idle(), moveX: 127 });
    expect(unshielded.player.integrity).toBe(2);

    const shielded = createAtlasState(ATLAS_CORE_FIXTURE);
    stepAtlas(shielded, { ...idle(), tool: 'shield-pulse' });
    stepAtlas(shielded, { ...idle(), moveX: 127 });
    expect(shielded.player.integrity).toBe(3);
    expect(shielded.events.some((event) => event.type === 'fault-shielded')).toBe(true);
  });

  it('records pause and visibility interruptions without advancing the simulation', () => {
    const state = createAtlasState(ATLAS_CORE_FIXTURE);
    stepAtlas(state, { ...idle(), moveX: 127, system: 'paused' });
    stepAtlas(state, { ...idle(), moveX: 127, system: 'hidden' });
    expect(state).toMatchObject({ tick: 0, player: { x: 0, y: 0 } });
    expect(state.events.map((event) => event.type)).toEqual(['paused', 'hidden']);
  });

  it('replays the same integer snapshot one thousand times', () => {
    const actions: AtlasAction[] = [
      { ...idle(), tool: 'shield-pulse' },
      ...Array.from({ length: 5 }, () => ({ ...idle(), moveX: 127 })),
      { ...idle(), tool: 'scanner' },
      { ...idle(), tool: 'relay-tether' },
      ...Array.from({ length: 15 }, () => ({ ...idle(), moveX: 127 })),
    ];
    const expected = replayAtlasActions(ATLAS_CORE_FIXTURE, actions);
    // toEqual on a full state object, a thousand times, is a second of deep
    // comparison. Comparing serialisations and asserting once is the same
    // property for a fraction of the cost.
    const serialised = JSON.stringify(expected);
    const drifted: number[] = [];
    for (let repeat = 0; repeat < 1_000; repeat += 1) {
      if (JSON.stringify(replayAtlasActions(ATLAS_CORE_FIXTURE, actions)) !== serialised) drifted.push(repeat);
    }
    expect(drifted).toEqual([]);
    expect(Number.isInteger(expected.player.x)).toBe(true);
    expect(expected.player.x).toBeLessThanOrEqual(ATLAS_CORE_FIXTURE.width);
  });

  it('keeps every shared core module free of browser and DOM dependencies', () => {
    for (const file of ['state.ts', 'step.ts', 'replay.ts', 'world.ts']) {
      const source = readFileSync(new URL(`../shared/atlas/${file}`, import.meta.url), 'utf8');
      expect(source).not.toMatch(/\b(document|window|navigator|HTMLElement|CanvasRenderingContext2D|localStorage)\b/);
    }
  });

  it('records the former adventure primitives being adapted without preserving combat authority', () => {
    expect(ATLAS_LEGACY_REUSE.map((item) => item.primitive)).toEqual([
      'traversal', 'collision', 'vehicle', 'city-interior', 'npc-rescue', 'knowledge-gate', 'ring-finale',
    ]);
    for (const item of ATLAS_LEGACY_REUSE) {
      expect(item.sourceFiles.length).toBeGreaterThan(0);
      expect(item.atlasUse.length).toBeGreaterThan(20);
      expect(item.atlasUse).not.toMatch(/shoot|weapon|kill|enemy/i);
    }
  });
});
