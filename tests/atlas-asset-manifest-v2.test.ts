import { describe, expect, it } from 'vitest';
import { parseAtlasAssetManifest } from '../src/atlas/assets/manifest';

const validManifest = {
  version: 2,
  mobileBudgetBytes: 262144,
  assets: [
    {
      id: 'beacon-commons-environment-v1',
      path: '/atlas/3d/v1/beacon-commons/environment.glb',
      sha256: 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb',
      bytes: 1,
      compressedBytes: 1,
      mime: 'model/gltf-binary',
      width: 1,
      height: 1,
      bundle: 'atlas-beacon-commons',
      quality: ['low', 'balanced', 'high'],
      sourceFile: 'art/atlas/environments/beacon-commons-v1/build_scene.py',
      sourceSha256: 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb',
      sourceStatus: 'owner-approved-procedural',
    },
  ],
};

describe('Atlas asset manifest v2', () => {
  it('accepts a procedurally sourced GLB entry', () => {
    const manifest = parseAtlasAssetManifest(validManifest);
    expect(manifest.version).toBe(2);
    expect(manifest.assets[0].sourceStatus).toBe('owner-approved-procedural');
  });

  it('keeps the existing v1 image and audio manifest readable', () => {
    const manifest = parseAtlasAssetManifest({
      version: 1,
      mobileBudgetBytes: 262144,
      assets: [{
        id: 'shell',
        path: '/icon.svg',
        sha256: 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb',
        bytes: 1,
        compressedBytes: 1,
        mime: 'image/svg+xml',
        width: 1,
        height: 1,
        bundle: 'atlas-shell',
      }],
    });
    expect(manifest.version).toBe(1);
  });

  it('rejects a 3D entry without procedural provenance', () => {
    const { sourceStatus: _sourceStatus, ...assetWithoutProvenance } = validManifest.assets[0];
    const invalid = { ...validManifest, assets: [assetWithoutProvenance] };
    expect(() => parseAtlasAssetManifest(invalid)).toThrow(/procedural provenance/i);
  });

  it('rejects external asset paths and duplicate ids', () => {
    expect(() => parseAtlasAssetManifest({
      ...validManifest,
      assets: [{ ...validManifest.assets[0], path: 'https://example.com/city.glb' }],
    })).toThrow(/asset path/i);
    expect(() => parseAtlasAssetManifest({
      ...validManifest,
      assets: [validManifest.assets[0], validManifest.assets[0]],
    })).toThrow(/duplicate asset/i);
  });
});
