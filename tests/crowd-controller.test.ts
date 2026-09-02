import { describe, expect, it } from 'vitest';
import { BEACON_COMMONS_CROWD, scheduleCrowd } from '../shared/atlas/city/crowd';
import { AtlasCrowdController } from '../src/atlas/city/crowd-controller';

describe('living city crowd', () => {
  it('produces deterministic schedules and keeps mission citizens visible', () => {
    const input = { districtId: 'beacon-commons', daySeed: 'day-1', restorationState: 'waiting' as const, qualityTier: 'balanced' as const, tick: 90 };
    expect(scheduleCrowd(input)).toEqual(scheduleCrowd(input));
    const guide = scheduleCrowd(input).find((citizen) => citizen.id === 'guide');
    expect(guide?.visible).toBe(true);
    expect(guide?.active).toBe(true);
    expect(scheduleCrowd({ ...input, daySeed: 'day-2' }).find((citizen) => citizen.id === 'guide')?.pathId).toBe(guide?.pathId);
  });

  it('keeps each route phase stable instead of adding simulation time twice', () => {
    const input = { districtId: 'beacon-commons', daySeed: 'day-1', restorationState: 'waiting' as const, qualityTier: 'balanced' as const };
    const first = scheduleCrowd({ ...input, tick: 0 });
    const later = scheduleCrowd({ ...input, tick: 900 });
    expect(later.map((citizen) => citizen.animationPhase)).toEqual(first.map((citizen) => citizen.animationPhase));
  });

  it('applies exact visible and active population caps per tier', () => {
    for (const [qualityTier, visible, active] of [['low', 8, 4], ['balanced', 12, 6], ['high', 17, 10]] as const) {
      const result = scheduleCrowd({ districtId: 'beacon-commons', daySeed: 'day-1', restorationState: 'waiting', qualityTier, tick: 0 });
      expect(result.filter((citizen) => citizen.visible)).toHaveLength(visible);
      expect(result.filter((citizen) => citizen.active)).toHaveLength(active);
    }
  });

  it('reacts to restoration without presenting live-player claims', () => {
    const result = scheduleCrowd({ districtId: 'beacon-commons', daySeed: 'day-1', restorationState: 'restored', qualityTier: 'high', tick: 30 });
    expect(result.every((citizen) => citizen.restorationReaction !== 'neutral')).toBe(true);
    expect(BEACON_COMMONS_CROWD.every((citizen) => !citizen.id.includes('live'))).toBe(true);
  });

  it('retains the latest presentation snapshot', () => {
    const controller = new AtlasCrowdController();
    const result = controller.update('beacon-commons', 'day-1', 'waiting', 'low', 0);
    expect(controller.snapshot()).toBe(result);
  });
});
