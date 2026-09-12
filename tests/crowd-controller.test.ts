import { describe, expect, it } from 'vitest';
import { BEACON_COMMONS_CROWD, scheduleCrowd } from '../shared/atlas/city/crowd';
import { AtlasCrowdController } from '../src/atlas/city/crowd-controller';

describe('living city crowd', () => {
  /*
   * A phone play test said the city "doesn't look interactive" and that
   * "people should be doing activities". They had nine activities between
   * them; each citizen was assigned one at boot and kept it all day, because
   * activityFor() read only the citizen's stable hash and never the clock.
   */
  const base = { districtId: 'beacon-commons', daySeed: 'day-1', restorationState: 'waiting' as const, qualityTier: 'high' as const };
  const activitiesOf = (tick: number) => new Map(scheduleCrowd({ ...base, tick }).map((citizen) => [citizen.id, citizen.activity]));

  it('changes what most citizens are doing as the clock runs', () => {
    const ticks = Array.from({ length: 41 }, (_value, index) => index * 60);
    const frames = ticks.map(activitiesOf);
    const ids = [...frames[0]!.keys()];
    const varying = ids.filter((id) => new Set(frames.map((frame) => frame.get(id))).size > 1);
    // Not all of them: the market roles stay pinned to the restoration state.
    expect(varying.length).toBeGreaterThanOrEqual(ids.length - 4);
  });

  it('does not turn the whole crowd over on one frame', () => {
    const ticks = Array.from({ length: 41 }, (_value, index) => index * 60);
    const frames = ticks.map(activitiesOf);
    const ids = [...frames[0]!.keys()];
    const firstChange = new Map<string, number>();
    for (const id of ids) {
      const index = frames.findIndex((frame, position) => position > 0 && frame.get(id) !== frames[position - 1]!.get(id));
      if (index > 0) firstChange.set(id, ticks[index]!);
    }
    // A crowd that all changes together reads as a cutscene, not a city.
    expect(new Set(firstChange.values()).size).toBeGreaterThan(3);
  });

  it('keeps the market pinned to the restoration state rather than a routine', () => {
    for (const tick of [0, 600, 1800, 5400]) {
      const waiting = scheduleCrowd({ ...base, tick }).filter((citizen) => citizen.role === 'community-merchant');
      const restored = scheduleCrowd({ ...base, restorationState: 'restored', tick }).filter((citizen) => citizen.role === 'community-merchant');
      expect(waiting.every((citizen) => citizen.activity === 'queueing')).toBe(true);
      expect(restored.every((citizen) => citizen.activity === 'trading')).toBe(true);
    }
  });

  it('stays deterministic, so the same moment always looks the same', () => {
    for (const tick of [0, 137, 900]) expect(scheduleCrowd({ ...base, tick })).toEqual(scheduleCrowd({ ...base, tick }));
  });


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
