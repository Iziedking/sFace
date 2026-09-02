import { describe, expect, it } from 'vitest';
import { parseAtlasCityScene } from '../shared/atlas/city/types';

const baseScene = {
  version: 1,
  districtId: 'beacon-commons',
  models: [{ id: 'hub', url: '/atlas/3d/v1/beacon-commons/environment.glb', contentType: 'model/gltf-binary' }],
  instances: [{ id: 'hub-instance', modelId: 'hub', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }],
  anchors: [{ id: 'arrival', kind: 'arrival', position: [0, 0, 0] }],
  paths: [{ id: 'main-path', points: [[0, 0, 0], [4, 0, 4]] }],
  colliders: [{ id: 'hub-collider', shape: 'box', position: [0, 1, 0], size: [2, 2, 2] }],
  emitters: [{ id: 'hub-light', kind: 'ambient', position: [0, 2, 0] }],
  navigation: {
    safeSpawn: [0, 0, 0],
    bounds: { minX: -8, maxX: 8, minZ: -12, maxZ: 6 },
    cameraHeadingRadians: Math.PI,
  },
};

describe('Atlas city scene contract', () => {
  it('accepts a valid native scene and returns frozen values', () => {
    const scene = parseAtlasCityScene(baseScene);
    expect(scene.districtId).toBe('beacon-commons');
    expect(Object.isFrozen(scene)).toBe(true);
    expect(Object.isFrozen(scene.models)).toBe(true);
    expect(Object.isFrozen(scene.instances[0])).toBe(true);
    expect(scene.navigation).toEqual(baseScene.navigation);
  });

  it('rejects a safe spawn outside the authored player navigation bounds', () => {
    expect(() =>
      parseAtlasCityScene({
        ...baseScene,
        navigation: { ...baseScene.navigation, safeSpawn: [20, 0, 0] },
      }),
    ).toThrow(/safe spawn/i);
  });

  it('rejects duplicate anchor ids', () => {
    expect(() =>
      parseAtlasCityScene({
        ...baseScene,
        anchors: [
          { id: 'arrival', kind: 'arrival', position: [0, 0, 0] },
          { id: 'arrival', kind: 'mission', position: [1, 0, 1] },
        ],
      }),
    ).toThrow(/duplicate anchor/i);
  });

  it('rejects an instance with an unknown model', () => {
    expect(() =>
      parseAtlasCityScene({
        ...baseScene,
        instances: [{ id: 'hub-instance', modelId: 'missing', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }],
      }),
    ).toThrow(/unknown model/i);
  });

  it('rejects external and parent-traversing asset urls', () => {
    expect(() => parseAtlasCityScene({ ...baseScene, models: [{ ...baseScene.models[0], url: 'https://example.com/city.glb' }] })).toThrow(/runtime asset url/i);
    expect(() => parseAtlasCityScene({ ...baseScene, models: [{ ...baseScene.models[0], url: '/atlas/../city.glb' }] })).toThrow(/runtime asset url/i);
  });

  it('rejects non-finite coordinates and short paths', () => {
    expect(() =>
      parseAtlasCityScene({
        ...baseScene,
        anchors: [{ id: 'arrival', kind: 'arrival', position: [Number.NaN, 0, 0] }],
      }),
    ).toThrow(/finite/i);
    expect(() =>
      parseAtlasCityScene({
        ...baseScene,
        paths: [{ id: 'main-path', points: [[0, 0, 0]] }],
      }),
    ).toThrow(/two points/i);
  });
});
