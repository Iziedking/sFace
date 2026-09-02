import { describe, expect, it } from 'vitest';

import { createAtlasState, snapshotAtlasState, type AtlasEventType } from '../shared/atlas/state';
import {
  ATLAS_MASTERY_MAX,
  calculateAtlasMastery,
  isAtlasMasteryPrizeEligible,
  type AtlasMasteryDefinition,
} from '../shared/atlas/mastery';
import { ATLAS_CORE_FIXTURE } from '../shared/atlas/world';
import type { AtlasAssistance } from '../shared/atlas/types';

const definition: AtlasMasteryDefinition = {
  requiredKnowledgeEvents: ['relay-scanned', 'relay-connected', 'rescued', 'gate-opened'],
  completionEvent: 'district-completed',
  optimalTicks: 10,
};

function snapshot(events: AtlasEventType[], tick: number, phase: 'running' | 'completed' | 'failed' = 'completed') {
  const state = createAtlasState(ATLAS_CORE_FIXTURE);
  state.phase = phase;
  state.tick = tick;
  state.events = events.map((type, index) => ({ tick: index + 1, type, targetId: 'fixture' }));
  return snapshotAtlasState(state);
}

describe('NIM Atlas transparent mastery scoring', () => {
  it('awards the exact 4,000/3,000/1,500/1,500 maximum for a clean complete run', () => {
    const result = calculateAtlasMastery(snapshot([
      'relay-scanned', 'relay-connected', 'fault-shielded', 'rescued', 'gate-opened', 'district-completed',
    ], 10), definition);
    expect(result).toEqual({ knowledge: 4_000, execution: 3_000, safety: 1_500, efficiency: 1_500, total: 10_000 });
    expect(result.total).toBe(ATLAS_MASTERY_MAX.total);
  });

  it('derives partial knowledge, completion, safety, and efficiency only from the replay snapshot', () => {
    const result = calculateAtlasMastery(snapshot(['relay-scanned', 'fault-hit', 'fault-hit'], 20, 'running'), definition);
    expect(result).toEqual({ knowledge: 1_000, execution: 0, safety: 500, efficiency: 750, total: 2_250 });
    expect(Object.values(result).every((value) => Number.isSafeInteger(value))).toBe(true);
  });

  it('keeps mastery bounded and excludes every assisted run from prize eligibility', () => {
    const result = calculateAtlasMastery(snapshot(Array.from({ length: 100 }, () => 'fault-hit'), Number.MAX_SAFE_INTEGER), definition);
    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(result.total).toBeLessThanOrEqual(ATLAS_MASTERY_MAX.total);
    const assistance: AtlasAssistance[] = ['none', 'free-hint', 'purchased-hint', 'answer-reveal', 'debug'];
    expect(assistance.map(isAtlasMasteryPrizeEligible)).toEqual([true, false, false, false, false]);
  });
});
