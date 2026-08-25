export interface AtlasLegacyReuseDecision {
  primitive: 'traversal' | 'collision' | 'vehicle' | 'city-interior' | 'npc-rescue' | 'knowledge-gate' | 'ring-finale';
  sourceFiles: string[];
  atlasUse: string;
}

export const ATLAS_LEGACY_REUSE: readonly AtlasLegacyReuseDecision[] = Object.freeze([
  {
    primitive: 'traversal',
    sourceFiles: ['src/game/player.ts', 'src/game/update.ts', 'src/core/input.ts'],
    atlasUse: 'Retain responsive two-axis movement and convert inputs into bounded integer Atlas actions.',
  },
  {
    primitive: 'collision',
    sourceFiles: ['src/game/collision.ts', 'src/game/city.ts'],
    atlasUse: 'Retain deterministic bounds and obstacle resolution for paths, structures, and temporary faults.',
  },
  {
    primitive: 'vehicle',
    sourceFiles: ['src/game/car.ts', 'src/game/convoy.ts'],
    atlasUse: 'Retain enter, exit, steering, and heavier movement for district transport and route repair.',
  },
  {
    primitive: 'city-interior',
    sourceFiles: ['src/game/city.ts'],
    atlasUse: 'Retain explorable street grids, enterable rooms, collision-safe doors, and deterministic placement.',
  },
  {
    primitive: 'npc-rescue',
    sourceFiles: ['src/game/face.ts', 'src/game/ally.ts', 'src/game/mission.ts'],
    atlasUse: 'Retain proximity-based rescue and following while using ecosystem roles and assistance objectives.',
  },
  {
    primitive: 'knowledge-gate',
    sourceFiles: ['src/core/gatecard.ts', 'src/game/state.ts'],
    atlasUse: 'Retain world-embedded gates while replacing recall prompts with sourced Builder Trial observations.',
  },
  {
    primitive: 'ring-finale',
    sourceFiles: ['src/game/rings.ts', 'src/game/ally.ts'],
    atlasUse: 'Retain concentric progression toward a visible core for the six-system Beacon installation finale.',
  },
]);
