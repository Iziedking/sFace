import type { AtlasCitySceneV1, AtlasVec3 } from './types';

const point = (x: number, y: number, z: number): AtlasVec3 => [x, y, z];
const anchor = (id: string, kind: 'arrival' | 'mission' | 'conversation' | 'work' | 'queue' | 'pickup' | 'install' | 'travel', position: AtlasVec3, radius: number) => ({ id, kind, position, radius });

const spawnPoints: readonly AtlasVec3[] = [
  point(-1, 0, 0.5), point(-5.2, 0, 0.4), point(-4.1, 0, -0.1), point(-3.5, 0, -1.1),
  point(7, 0, 1.8), point(8.2, 0, 1.2), point(2.1, 0, -1.3), point(2.1, 0, -3.2),
  point(4.3, 0, -0.8), point(5.55, 0, -0.8), point(-2.2, 0, -5), point(2.7, 0, -5),
];

export const PAY_HARBOR_CITY: AtlasCitySceneV1 = {
  version: 1,
  districtId: 'pay-harbor',
  models: [
    { id: 'pay-harbor-environment', url: '/atlas/3d/v1/pay-harbor/environment.glb', contentType: 'model/gltf-binary' },
    { id: 'atlas-walker-player', url: '/atlas/3d/v1/characters/atlas-walker-player.glb', contentType: 'model/gltf-binary' },
    { id: 'atlas-walker-npc-lod1', url: '/atlas/3d/v1/characters/atlas-walker-npc-lod1.glb', contentType: 'model/gltf-binary' },
    { id: 'atlas-walker-npc-lod2', url: '/atlas/3d/v1/characters/atlas-walker-npc-lod2.glb', contentType: 'model/gltf-binary' },
  ],
  instances: [
    { id: 'pay-harbor-environment-instance', modelId: 'pay-harbor-environment', position: point(0, 0, 0), rotation: point(0, 0, 0), scale: point(1, 1, 1) },
    { id: 'atlas-walker-player-instance', modelId: 'atlas-walker-player', position: point(0, 0, 6.2), rotation: point(0, 3.14159265359, 0), scale: point(1, 1, 1) },
  ],
  anchors: [
    anchor('arrival-dock', 'arrival', point(0, 0, 6.2), 1.3),
    anchor('mara-harbor-keeper', 'conversation', point(-1, 0, 0.5), 1.2),
    anchor('lantern-counter', 'mission', point(-4.4, 0, -0.9), 1.1),
    anchor('payment-review', 'conversation', point(-3.8, 0, -1.4), 1.0),
    anchor('relay-pickup', 'pickup', point(2.1, 0, -1.3), 1.0),
    anchor('station-1-install', 'install', point(4.3, 0, -0.8), 0.8),
    anchor('station-2-install', 'install', point(5.55, 0, -0.8), 0.8),
    anchor('station-3-install', 'install', point(6.8, 0, -0.8), 0.8),
    anchor('station-4-install', 'install', point(4.3, 0, -2.95), 0.8),
    anchor('station-5-install', 'install', point(5.55, 0, -2.95), 0.8),
    anchor('station-6-install', 'install', point(6.8, 0, -2.95), 0.8),
    anchor('builder-workbench', 'work', point(7, 0, 1.8), 1.4),
    anchor('ferry-boarding', 'travel', point(0, 0, -5.7), 2.0),
    anchor('beacon-return-gate', 'travel', point(0, 0, 6.2), 1.4),
    anchor('conversation-market', 'conversation', point(-5.2, 0, 0.4), 1.2),
    anchor('conversation-workshop', 'conversation', point(7, 0, 1.8), 1.2),
    anchor('queue-lantern-counter', 'queue', point(-4.4, 0, -0.9), 1.0),
    anchor('queue-relay-stations', 'queue', point(4.3, 0, -0.8), 1.0),
    anchor('celebration-harbor-tower', 'install', point(0, 0, 3.6), 1.5),
    ...spawnPoints.map((position, index) => anchor(`npc-spawn-${String(index + 1).padStart(2, '0')}`, 'arrival', position, 0.65)),
  ],
  paths: [
    { id: 'arrival-to-keeper', points: [point(0, 0, 6.2), point(-1, 0, 0.5)], purpose: 'walk', speed: 1.8 },
    { id: 'keeper-to-counter', points: [point(-1, 0, 0.5), point(-4.4, 0, -0.9)], purpose: 'conversation', speed: 1.1 },
    { id: 'queue-lantern', points: [point(-3.5, 0, -1.1), point(-4.1, 0, -0.1), point(-5.2, 0, 0.4)], purpose: 'queue', speed: 0.65 },
    { id: 'queue-installation', points: [point(2.1, 0, -1.3), point(4.3, 0, -0.8), point(5.55, 0, -0.8), point(6.8, 0, -2.95)], purpose: 'queue', speed: 0.65 },
    { id: 'restoration-loop', points: [point(2.1, 0, -1.3), point(0, 0, 3.6), point(0, 0, -5.7)], purpose: 'celebration', speed: 1.4 },
  ],
  colliders: [
    { id: 'obstruction-market', shape: 'box', position: point(-6.7, 1.25, 1), size: point(4.7, 2.5, 3.4) },
    { id: 'obstruction-ferry', shape: 'box', position: point(0, 1.15, -8.5), size: point(5.2, 1.4, 2.2) },
    { id: 'obstruction-builder-workshop', shape: 'box', position: point(7, 0.75, 1.8), size: point(3.2, 1.5, 1.3) },
    { id: 'obstruction-tower', shape: 'capsule', position: point(0, 2.4, 3.6), size: point(2.4, 4.8, 2.4) },
  ],
  emitters: [
    { id: 'harbor-ambient', kind: 'ambient', position: point(0, 3, -2), intensity: 0.8 },
    { id: 'lantern-counter-light', kind: 'lantern', position: point(-4.4, 1.7, -0.9), intensity: 1 },
    { id: 'restoration-light', kind: 'restoration', position: point(0, 4.8, 3.6), intensity: 0.7 },
    { id: 'harbor-water', kind: 'water', position: point(0, 0, -10), intensity: 0.5 },
  ],
};
