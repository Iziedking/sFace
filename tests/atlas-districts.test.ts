import { describe, expect, it } from 'vitest';

import { ATLAS_EVERGREEN_ADVENTURES, replayEvergreenAdventure } from '../shared/atlas/adventures/evergreen';
import { createAtlasState } from '../shared/atlas/state';

describe('NIM Atlas evergreen districts', () => {
  it('ships five human-scale districts plus Beacon Core with walkable missions and official sources', () => {
    expect(ATLAS_EVERGREEN_ADVENTURES).toHaveLength(5);
    expect(new Set(ATLAS_EVERGREEN_ADVENTURES.map((adventure) => adventure.districtId)).size).toBe(5);
    for (const adventure of ATLAS_EVERGREEN_ADVENTURES) {
      expect(adventure.humanNeed.length).toBeGreaterThan(20);
      expect(adventure.location.length).toBeGreaterThan(10);
      expect(adventure.consequence.after.length).toBeGreaterThan(10);
      expect(adventure.sources.every((source) => source.url.startsWith('https://nimiq.dev/'))).toBe(true);
      expect(() => createAtlasState(adventure.mission)).not.toThrow();
    }
  });

  it('makes Explorer and Builder actions converge on the same consequence', () => {
    for (const adventure of ATLAS_EVERGREEN_ADVENTURES) {
      const explorer = replayEvergreenAdventure(adventure, [
        { type: 'observe' },
        { type: 'act', role: 'explorer' },
        ...adventure.teachBack.map((answer) => ({ type: 'teach-back' as const, answer })),
      ]);
      const builder = replayEvergreenAdventure(adventure, [
        { type: 'observe' },
        { type: 'act', role: 'builder' },
        ...adventure.teachBack.map((answer) => ({ type: 'teach-back' as const, answer })),
      ]);
      expect(explorer.phase).toBe('completed');
      expect(builder.phase).toBe('completed');
      expect(explorer.consequence).toBe(adventure.consequence.after);
      expect(builder.consequence).toBe(adventure.consequence.after);
      expect(() => replayEvergreenAdventure(adventure, [{ type: 'act', role: 'explorer' }])).toThrow(/observe|sequence/i);
    }
  });
});
