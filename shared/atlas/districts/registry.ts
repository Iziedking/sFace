import type { AtlasLivingWorldDefinition } from '../living-world';

import { ALBATROSS_CAUSEWAY_WORLD } from './albatross-causeway-world';
import { BEACON_CORE_WORLD } from './beacon-core-world';
import { BUILDER_CITY_WORLD } from './builder-city-world';
import { GENESIS_GARDEN_WORLD } from './genesis-garden-world';
import { LIGHT_FOREST_WORLD } from './light-forest-world';
import { PAY_HARBOR_WORLD } from './pay-harbor';
import { VALIDATOR_PEAKS_WORLD } from './validator-peaks-world';

/**
 * Every district world, in one place, ordered by the rung it teaches.
 *
 * The order is the cascade, not the alphabet. Each district restates one idea,
 * that an assertion is not evidence, at a larger scale than the district
 * before it, so reordering this array changes what the game teaches and in
 * what order a player can understand it.
 *
 * This list exists because the districts were previously imported one at a
 * time by whoever needed them, which meant nothing could ask a question about
 * the curriculum as a whole. Six of the seven chapters had drifted into
 * restatements of the same lesson and no test could see it.
 *
 * The reasoning is also in
 * docs/superpowers/specs/2026-09-01-readiness-cascade-design.md. If that spec
 * and this comment disagree, this comment ships and the spec is the bug.
 */
export const ATLAS_DISTRICT_WORLDS: readonly AtlasLivingWorldDefinition[] = Object.freeze([
  GENESIS_GARDEN_WORLD,
  PAY_HARBOR_WORLD,
  ALBATROSS_CAUSEWAY_WORLD,
  VALIDATOR_PEAKS_WORLD,
  LIGHT_FOREST_WORLD,
  BUILDER_CITY_WORLD,
  BEACON_CORE_WORLD,
]);
