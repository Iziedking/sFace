import { describe, expect, it } from 'vitest';
import { LIGHT_FOREST_WORLD, lightForestRestoration } from '../shared/atlas/districts/light-forest-world';
import { ALBATROSS_CAUSEWAY_WORLD, albatrossCausewayRestoration } from '../shared/atlas/districts/albatross-causeway-world';
import { VALIDATOR_PEAKS_WORLD, validatorPeaksRestoration } from '../shared/atlas/districts/validator-peaks-world';
import { BUILDER_CITY_WORLD, builderCityRestoration } from '../shared/atlas/districts/builder-city-world';
import { GENESIS_GARDEN_WORLD, genesisGardenRestoration } from '../shared/atlas/districts/genesis-garden-world';
import { BEACON_CORE_WORLD, beaconCoreRestoration, canInstallBeaconCore } from '../shared/atlas/districts/beacon-core-world';
import { createAtlasPassportView } from '../src/atlas/ui/atlas-passport';
import { createDistrictScene } from '../src/atlas/scenes/district-scene';
import type { AtlasLivingWorldDefinition } from '../shared/atlas/living-world';
import type { AtlasRestorationState } from '../shared/atlas/living-world';

const chapters: readonly { world: AtlasLivingWorldDefinition; restore: (events: Parameters<typeof lightForestRestoration>[0]) => AtlasRestorationState }[] = [
  { world: LIGHT_FOREST_WORLD, restore: lightForestRestoration },
  { world: ALBATROSS_CAUSEWAY_WORLD, restore: albatrossCausewayRestoration },
  { world: VALIDATOR_PEAKS_WORLD, restore: validatorPeaksRestoration },
  { world: BUILDER_CITY_WORLD, restore: builderCityRestoration },
  { world: GENESIS_GARDEN_WORLD, restore: genesisGardenRestoration },
];

describe('NIM Atlas Living Restoration districts', () => {
  for (const { world, restore } of chapters) {
    it(`${world.districtId} teaches a human need through both paths and visible restoration`, () => {
      expect(world.id).toContain('-world-v1');
      expect(world.chapter.humanNeed.length).toBeGreaterThan(20);
      expect(world.chapter.explorerAction.length).toBeGreaterThan(20);
      expect(world.chapter.builderRepair.length).toBeGreaterThan(20);
      expect(world.chapter.proof.length).toBeGreaterThan(20);
      expect(world.chapter.installation.length).toBeGreaterThan(20);
      expect(world.chapter.teachBack.length).toBeGreaterThan(20);
      expect(restore([])).toBe('waiting');
      expect(restore([{ tick: 10, type: 'district-completed', targetId: world.mission.gate.id }])).toBe('restored');

      const waiting = createDistrictScene({ world, restoration: 'waiting', reducedMotion: false });
      const restored = createDistrictScene({ world, restoration: 'restored', reducedMotion: true });
      expect(waiting.activeEntityIds.length).toBeGreaterThan(0);
      expect(restored.activeEntityIds.length).toBeGreaterThan(0);
      expect(restored.restorationEffects.every(Boolean)).toBe(true);
      expect(restored.ambientMotionEnabled).toBe(false);
      expect(restored.proof).toBe(world.chapter.proof);
    });
  }

  it('requires six district seals for Beacon Core and never exposes a full wallet address', () => {
    expect(BEACON_CORE_WORLD.requiredDistricts).toHaveLength(6);
    expect(canInstallBeaconCore(BEACON_CORE_WORLD.requiredDistricts.slice(0, 5))).toBe(false);
    expect(canInstallBeaconCore(BEACON_CORE_WORLD.requiredDistricts)).toBe(true);
    const passport = createAtlasPassportView({ actorId: 'actor-1', maskedAddress: 'NQXX-1234-5678-ABCD', districtSeals: ['genesis-garden'], verifiedTrialIds: [], recipeIds: [], expeditionRunIds: [], updatedAt: 1 });
    expect(passport.maskedWallet).not.toBe('NQXX-1234-5678-ABCD');
    expect(passport.maskedWallet).toBe('NQXX...ABCD');
  });

  it('composes six relay observations, safety, and completion before restoring Beacon Core', () => {
    const relays = BEACON_CORE_WORLD.mission.relays.map((relay, tick) => ({ tick, type: 'relay-connected' as const, targetId: relay.id }));
    expect(beaconCoreRestoration(relays)).toBe('confirming');
    expect(beaconCoreRestoration([...relays, { tick: 7, type: 'fault-shielded', targetId: 'beacon-authority-knot' }, { tick: 8, type: 'rescued', targetId: 'beacon-keeper' }])).toBe('confirming');
    expect(beaconCoreRestoration([...relays, { tick: 7, type: 'fault-shielded', targetId: 'beacon-authority-knot' }, { tick: 8, type: 'rescued', targetId: 'beacon-keeper' }, { tick: 9, type: 'district-completed', targetId: 'beacon-installation' }])).toBe('restored');
  });
});
