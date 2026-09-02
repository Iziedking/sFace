import { describe, expect, it } from 'vitest';

import { createAtlasState } from '../shared/atlas/state';
import { stepAtlas } from '../shared/atlas/step';
import { GENESIS_GARDEN_MISSION, genesisObjective } from '../shared/atlas/districts/genesis-garden';
import { gradeGenesisTrial } from '../src/atlas/trials/genesis';
import { createAtlasProgressStore } from '../src/atlas/progress';

describe('Genesis Garden first district', () => {
  it('guides the player through place, tool, rescue, gate, and Builder Trial objectives', () => {
    const state = createAtlasState(GENESIS_GARDEN_MISSION);
    expect(genesisObjective(state).short).toBe('Find the Address Stone');
    moveTo(state, GENESIS_GARDEN_MISSION.relays[0]!.x, GENESIS_GARDEN_MISSION.relays[0]!.y);
    stepAtlas(state, { moveX: 0, moveY: 0, tool: 'scanner', interact: false });
    expect(genesisObjective(state).short).toBe('Reconnect the address path');
    stepAtlas(state, { moveX: 0, moveY: 0, tool: 'relay-tether', interact: false });
    expect(genesisObjective(state).short).toBe('Meet Mara');
    moveTo(state, GENESIS_GARDEN_MISSION.rescue.x, GENESIS_GARDEN_MISSION.rescue.y);
    stepAtlas(state, { moveX: 0, moveY: 0, tool: 'none', interact: true });
    expect(genesisObjective(state).short).toBe('Enter Genesis Gate');
    moveTo(state, GENESIS_GARDEN_MISSION.gate.x, GENESIS_GARDEN_MISSION.gate.y);
    stepAtlas(state, { moveX: 0, moveY: 0, tool: 'none', interact: true });
    expect(genesisObjective(state).short).toBe('Open the Builder Trial');
    expect(state.phase).toBe('completed');
    expect(state.player.integrity).toBeGreaterThan(0);
  });

  it('teaches the exact NIM-to-Luna conversion and exposes its sourced recipe', () => {
    expect(gradeGenesisTrial('1_200_000')).toMatchObject({ correct: true, luna: 1_200_000 });
    expect(gradeGenesisTrial('120_000').correct).toBe(false);
    expect(gradeGenesisTrial('12_000_000').correct).toBe(false);
    const answer = gradeGenesisTrial('1_200_000');
    expect(answer.sourceUrl).toBe('https://nimiq.dev/mini-apps/api-reference/nimiq-provider');
    expect(answer.recipe).toContain('100_000');
  });

  it('persists free local campaign progress without any wallet identity', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const store = createAtlasProgressStore(storage);
    expect(store.load()).toMatchObject({ version: 3, completedAdventureIds: [], completedTrialIds: [], activeRole: 'explorer', avatar: { face: 'face-01', body: 'body-01' } });
    store.completeDistrict('genesis-garden');
    store.completeTrial('luna-lens');
    expect(createAtlasProgressStore(storage).load()).toMatchObject({ version: 3, completedAdventureIds: ['genesis-garden'], completedTrialIds: ['luna-lens'], avatar: { face: 'face-01', body: 'body-01' } });
    expect(JSON.stringify([...values.values()])).not.toMatch(/wallet|address|device/i);
  });
});

function moveTo(state: ReturnType<typeof createAtlasState>, targetX: number, targetY: number): void {
  while (state.player.x !== targetX) {
    stepAtlas(state, { moveX: Math.sign(targetX - state.player.x) * 127, moveY: 0, tool: 'none', interact: false });
  }
  while (state.player.y !== targetY) {
    stepAtlas(state, { moveX: 0, moveY: Math.sign(targetY - state.player.y) * 127, tool: 'none', interact: false });
  }
}
