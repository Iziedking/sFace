import { describe, expect, it } from 'vitest';
import { projectLivingWorld } from '../shared/atlas/living-world';
import { PAY_HARBOR_WORLD } from '../shared/atlas/districts/pay-harbor';
import { createAtlasState } from '../shared/atlas/state';

describe('living-world projection', () => {
  it('projects the deterministic mission and only the entities for the current restoration state', () => {
    const state = createAtlasState(PAY_HARBOR_WORLD.mission);
    const waiting = projectLivingWorld(PAY_HARBOR_WORLD, state, 'waiting');
    const restored = projectLivingWorld(PAY_HARBOR_WORLD, state, 'restored');

    expect(waiting.districtId).toBe('pay-harbor');
    expect(waiting.restoration).toBe('waiting');
    expect(waiting.simulation).toEqual(expect.objectContaining({ phase: 'running', tick: 0 }));
    expect(waiting.entities.some((entity) => entity.id === 'mara')).toBe(true);
    expect(waiting.entities.find((entity) => entity.id === 'waiting-lantern-stall')?.active).toBe(true);
    expect(waiting.entities.find((entity) => entity.id === 'restored-lantern-stall')?.active).toBe(false);
    expect(restored.entities.find((entity) => entity.id === 'restored-lantern-stall')?.active).toBe(true);
    expect(restored.entities.find((entity) => entity.id === 'waiting-lantern-stall')?.active).toBe(false);
  });

  it('does not mutate the deterministic simulation state while projecting', () => {
    const state = createAtlasState(PAY_HARBOR_WORLD.mission);
    const before = structuredClone(state);

    projectLivingWorld(PAY_HARBOR_WORLD, state, 'confirming');

    expect(state).toEqual(before);
  });
});
