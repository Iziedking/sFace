import { describe, expect, it } from 'vitest';

import { AtlasLivingCityController, type AtlasLivingCityRenderer } from '../src/atlas/city/living-city-controller';
import { ATLAS_DISTRICT_WORLDS } from '../shared/atlas/districts/registry';
import { projectLivingWorld, type AtlasRestorationState } from '../shared/atlas/living-world';
import { createAtlasState } from '../shared/atlas/state';

const harbor = ATLAS_DISTRICT_WORLDS.find((world) => world.districtId === 'pay-harbor')!;

function stubRenderer(): AtlasLivingCityRenderer {
  return {
    loadDistrict: async () => undefined,
    releaseDistrict: async () => undefined,
    render: () => undefined,
    resize: () => undefined,
    destroy: async () => undefined,
  };
}

function controller(): AtlasLivingCityController {
  // A frame loop that never fires, so these tests exercise beat selection
  // rather than the render loop.
  return new AtlasLivingCityController({
    renderer: stubRenderer(),
    frameLoop: { request: () => 1, cancel: () => undefined },
  });
}

function snapshotFor(restoration: AtlasRestorationState = 'waiting') {
  return projectLivingWorld(harbor, createAtlasState(harbor.mission), restoration);
}

describe('living city beat routing', () => {
  it('has no beat before a district is presented', () => {
    expect(controller().beat()).toBeNull();
  });

  it('opens on arrive once a district is presented', () => {
    const city = controller();
    city.present(snapshotFor());
    expect(city.beat()?.kind).toBe('arrive');
    expect(city.beat()?.districtId).toBe('pay-harbor');
    expect(city.beat()?.scale).toBe('lookup');
  });

  it('walks the beats forward as progress is recorded', () => {
    const city = controller();
    city.present(snapshotFor());
    city.advance({ reachedNeed: true });
    expect(city.beat()?.kind).toBe('witness');
    city.advance({ attempted: true });
    expect(city.beat()?.kind).toBe('refused');
    expect(city.beat()?.refusalReason).toBe(harbor.chapter.refutation);
  });

  it('never lets progress move backwards', () => {
    // A player who could un-attempt would be able to replay the refusal and
    // skip the evidence step, which is the one step the teach-back rests on.
    const city = controller();
    city.present(snapshotFor());
    city.advance({ reachedNeed: true, attempted: true });
    city.advance({ reachedNeed: false, attempted: false });
    expect(city.beat()?.kind).toBe('refused');
  });

  it('reaches install only once the district is restored, then teach-back', () => {
    const city = controller();
    city.present(snapshotFor('confirming'));
    city.advance({ reachedNeed: true, attempted: true, evidenceGathered: true });
    expect(city.beat()?.kind).toBe('gather');
    city.present(snapshotFor('restored'));
    expect(city.beat()?.kind).toBe('install');
    city.advance({ installed: true });
    expect(city.beat()?.kind).toBe('teach-back');
    expect(city.beat()?.detail).toBe(harbor.chapter.teachBack);
  });

  it('keeps progress when a new snapshot of the same district arrives', () => {
    const city = controller();
    city.present(snapshotFor());
    city.advance({ reachedNeed: true, attempted: true });
    city.present(snapshotFor());
    expect(city.beat()?.kind).toBe('refused');
  });
});
