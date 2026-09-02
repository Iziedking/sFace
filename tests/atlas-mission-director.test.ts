import { describe, expect, it } from 'vitest';

import { createAtlasCityPlayer } from '../shared/atlas/city/player';
import { ATLAS_DISTRICT_WORLDS } from '../shared/atlas/districts/registry';
import { projectLivingWorld, type AtlasLivingWorldDefinition, type AtlasRestorationState } from '../shared/atlas/living-world';
import { directAtlasMission, type AtlasMissionProgress } from '../shared/atlas/mission-director';
import { createAtlasState } from '../shared/atlas/state';

const nothingDone: AtlasMissionProgress = { reachedNeed: false, attempted: false, evidenceGathered: false, installed: false, taughtBack: false };
const player = createAtlasCityPlayer({ x: 0, z: 0, facing: 'up' });

function snapshotFor(world: AtlasLivingWorldDefinition, restoration: AtlasRestorationState = 'waiting') {
  return projectLivingWorld(world, createAtlasState(world.mission), restoration);
}

const firstWorld = ATLAS_DISTRICT_WORLDS[0]!;
const harbor = ATLAS_DISTRICT_WORLDS[1]!;

describe('Atlas mission director', () => {
  it('opens on arrive before the player has reached the need', () => {
    const beat = directAtlasMission(firstWorld.chapter, snapshotFor(firstWorld), player, nothingDone);
    expect(beat.kind).toBe('arrive');
    expect(beat.districtId).toBe(firstWorld.districtId);
    expect(beat.scale).toBe(firstWorld.chapter.scale);
    expect(beat.refusalReason).toBeNull();
  });

  it('witnesses the need once the player has reached it', () => {
    const beat = directAtlasMission(firstWorld.chapter, snapshotFor(firstWorld), player, { ...nothingDone, reachedNeed: true });
    expect(beat.kind).toBe('witness');
    expect(beat.headline).toBe(firstWorld.chapter.humanNeed);
  });

  it('refuses the naive attempt in every district and gives that district refutation as the reason', () => {
    for (const world of ATLAS_DISTRICT_WORLDS) {
      const beat = directAtlasMission(world.chapter, snapshotFor(world), player, { ...nothingDone, reachedNeed: true, attempted: true });
      expect(beat.kind, `district ${world.districtId}`).toBe('refused');
      expect(beat.refusalReason, `refusal for ${world.districtId}`).toBe(world.chapter.refutation);
      expect(beat.headline, `claim for ${world.districtId}`).toBe(world.chapter.claim);
      expect(beat.detail, `evidence for ${world.districtId}`).toBe(world.chapter.evidence);
    }
  });

  it('keeps refusing until the evidence has actually been gathered', () => {
    const beat = directAtlasMission(harbor.chapter, snapshotFor(harbor, 'confirming'), player, { ...nothingDone, reachedNeed: true, attempted: true });
    expect(beat.kind).toBe('refused');
  });

  it('moves to install only once evidence is gathered and the district is restored', () => {
    const gathered: AtlasMissionProgress = { reachedNeed: true, attempted: true, evidenceGathered: true, installed: false, taughtBack: false };
    expect(directAtlasMission(harbor.chapter, snapshotFor(harbor, 'confirming'), player, gathered).kind).toBe('gather');
    expect(directAtlasMission(harbor.chapter, snapshotFor(harbor, 'restored'), player, gathered).kind).toBe('install');
  });

  it('ends on teach-back and stays there', () => {
    const installed: AtlasMissionProgress = { reachedNeed: true, attempted: true, evidenceGathered: true, installed: true, taughtBack: false };
    const beat = directAtlasMission(harbor.chapter, snapshotFor(harbor, 'restored'), player, installed);
    expect(beat.kind).toBe('teach-back');
    expect(beat.detail).toBe(harbor.chapter.teachBack);
    expect(directAtlasMission(harbor.chapter, snapshotFor(harbor, 'restored'), player, { ...installed, taughtBack: true }).kind).toBe('teach-back');
  });

  it('produces a beat for every district at every stage without throwing', () => {
    const stages: AtlasMissionProgress[] = [
      nothingDone,
      { ...nothingDone, reachedNeed: true },
      { ...nothingDone, reachedNeed: true, attempted: true },
      { reachedNeed: true, attempted: true, evidenceGathered: true, installed: false, taughtBack: false },
      { reachedNeed: true, attempted: true, evidenceGathered: true, installed: true, taughtBack: false },
    ];
    for (const world of ATLAS_DISTRICT_WORLDS) {
      for (const restoration of ['waiting', 'confirming', 'restored'] as const) {
        for (const progress of stages) {
          expect(() => directAtlasMission(world.chapter, snapshotFor(world, restoration), player, progress), `${world.districtId} ${restoration}`).not.toThrow();
        }
      }
    }
  });

  it('refuses a malformed player position rather than emitting a beat about nowhere', () => {
    const broken = { ...player, x: Number.NaN };
    expect(() => directAtlasMission(harbor.chapter, snapshotFor(harbor), broken, nothingDone)).toThrow(/malformed player position/i);
  });
});
