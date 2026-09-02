import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseAtlasAssetManifest } from '../src/atlas/assets/manifest';
import { isAtlasCitizenPositionBlocked } from '../shared/atlas/city/citizen-motion';
import { parseAtlasCityScene } from '../shared/atlas/city/types';

function readGlbJson(path: string): Record<string, any> {
  const bytes = readFileSync(path);
  expect(bytes.subarray(0, 4).toString('ascii')).toBe('glTF');
  expect(bytes.readUInt32LE(4)).toBe(2);
  const jsonLength = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8')) as Record<string, any>;
}

function triangleCount(document: Record<string, any>): number {
  return document.meshes.reduce((sum: number, mesh: { primitives: Array<{ indices: number }> }) => sum + mesh.primitives.reduce((meshSum, primitive) => meshSum + document.accessors[primitive.indices].count / 3, 0), 0);
}

function animatedNodes(document: Record<string, any>, clipName: string): Set<string> {
  const clip = document.animations.find((candidate: { name?: string }) => candidate.name === clipName);
  expect(clip, `missing animation clip ${clipName}`).toBeDefined();
  return new Set(clip.channels.map((channel: { target: { node: number } }) => document.nodes[channel.target.node].name));
}

describe('Atlas 3D asset registry', () => {
  it('parses the checked-in v2 manifest', () => {
    const manifest = parseAtlasAssetManifest(JSON.parse(readFileSync('public/atlas/manifests/assets-v2.json', 'utf8')));
    expect(manifest.version).toBe(2);
    expect(manifest.assets.length).toBe(11);
    expect(manifest.assets.filter((asset) => asset.mime === 'model/gltf-binary')).toHaveLength(5);
  });

  it('keeps procedural approval separate from rejected references', () => {
    const records = JSON.parse(readFileSync('art/atlas/licenses.json', 'utf8')) as Array<{ id: string; status: string; sourceFile: string }>;
    expect(records.find((record) => record.id === 'atlas-walker-v1-procedural')).toMatchObject({
      status: 'owner-approved-procedural',
      sourceFile: 'art/atlas/characters/atlas-walker-v1/build_character.py',
    });
    expect(records.find((record) => record.id === 'avatar-sheet')).toMatchObject({ status: 'rejected-reference' });
    expect(records.filter((record) => record.status === 'owner-approved-procedural')).toHaveLength(2);
  });

  it('keeps the player and NPC LOD budgets honest', () => {
    const player = readGlbJson('public/atlas/3d/v1/characters/atlas-walker-player.glb');
    const lod1 = readGlbJson('public/atlas/3d/v1/characters/atlas-walker-npc-lod1.glb');
    const lod2 = readGlbJson('public/atlas/3d/v1/characters/atlas-walker-npc-lod2.glb');
    expect(triangleCount(player)).toBeLessThanOrEqual(5200);
    expect(triangleCount(player)).toBeGreaterThan(4200);
    expect(player.skins[0].joints).toHaveLength(23);
    expect(player.materials).toHaveLength(8);
    expect(player.images).toBeUndefined();
    expect(player.textures).toBeUndefined();
    expect(triangleCount(lod1)).toBeLessThanOrEqual(3300);
    expect(triangleCount(lod1)).toBeGreaterThan(3000);
    expect(lod1.skins[0].joints).toHaveLength(23);
    expect(triangleCount(lod2)).toBeLessThanOrEqual(800);
  });

  it('ships dedicated authored idle, walk, and run clips', () => {
    const player = readGlbJson('public/atlas/3d/v1/characters/atlas-walker-player.glb');
    expect(player.animations.map((clip: { name: string }) => clip.name)).toEqual(['Atlas_Idle', 'Atlas_Walk', 'Atlas_Run']);
    expect(player.nodes.map((node: { name: string }) => node.name)).toEqual(expect.arrayContaining(['eye.L', 'eye.R', 'eyelid.L', 'eyelid.R', 'mouth']));
    expect(animationFrameCount(player, 'Atlas_Idle')).toBeGreaterThanOrEqual(13);
    expect(animationFrameCount(player, 'Atlas_Walk')).toBeGreaterThanOrEqual(25);
    expect(animationDuration(player, 'Atlas_Walk')).toBeCloseTo(1.2, 2);
    expect(animationFrameCount(player, 'Atlas_Run')).toBeGreaterThanOrEqual(13);
    expect([...animatedNodes(player, 'Atlas_Idle')]).toEqual(expect.arrayContaining(['hips', 'chest', 'head']));
    for (const clipName of ['Atlas_Walk', 'Atlas_Run']) {
      expect([...animatedNodes(player, clipName)]).toEqual(
        expect.arrayContaining([
          'hips',
          'chest',
          'upper_arm.L',
          'lower_arm.L',
          'upper_arm.R',
          'lower_arm.R',
          'upper_leg.L',
          'lower_leg.L',
          'foot.L',
          'upper_leg.R',
          'lower_leg.R',
          'foot.R',
        ]),
      );
    }
  });

  it('keeps Beacon Commons as a real scene contract with readable anchors', () => {
    const scene = parseAtlasCityScene(JSON.parse(readFileSync('public/atlas/3d/v1/beacon-commons/scene.json', 'utf8')));
    const kinds = new Set(scene.anchors.map((anchor) => anchor.kind));
    expect(scene.models).toHaveLength(4);
    expect(scene.anchors.filter((anchor) => anchor.id.startsWith('npc-spawn-'))).toHaveLength(17);
    expect(scene.paths.filter((path) => path.purpose === 'queue')).toHaveLength(2);
    expect(scene.navigation).toMatchObject({
      safeSpawn: [0, 0, 4.2],
      bounds: { minX: -9.4, maxX: 9.4 },
    });
    expect(kinds).toEqual(new Set(['arrival', 'travel', 'mission', 'conversation', 'work', 'queue']));
    const environment = readGlbJson('public/atlas/3d/v1/beacon-commons/environment.glb');
    expect(triangleCount(environment)).toBeLessThanOrEqual(120000);
  });

  it('authors every Beacon citizen spawn outside building footprints', () => {
    const scene = parseAtlasCityScene(JSON.parse(readFileSync('public/atlas/3d/v1/beacon-commons/scene.json', 'utf8')));
    const blockedSpawns = scene.anchors
      .filter((anchor) => anchor.id.startsWith('npc-spawn-'))
      .filter((anchor) => isAtlasCitizenPositionBlocked({ x: anchor.position[0], z: anchor.position[2] }, scene.colliders))
      .map((anchor) => anchor.id);
    expect(blockedSpawns).toEqual([]);
  });

  it('authors Beacon walking lanes around buildings instead of through them', () => {
    const scene = parseAtlasCityScene(JSON.parse(readFileSync('public/atlas/3d/v1/beacon-commons/scene.json', 'utf8')));
    const blockedPathSegments = new Set<string>();
    for (const path of scene.paths) {
      for (let pointIndex = 1; pointIndex < path.points.length; pointIndex += 1) {
        const from = path.points[pointIndex - 1]!;
        const to = path.points[pointIndex]!;
        const samples = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[2] - from[2]) / 0.2));
        for (let sample = 0; sample <= samples; sample += 1) {
          const amount = sample / samples;
          const position = { x: from[0] + (to[0] - from[0]) * amount, z: from[2] + (to[2] - from[2]) * amount };
          if (isAtlasCitizenPositionBlocked(position, scene.colliders)) blockedPathSegments.add(`${path.id}:${pointIndex - 1}-${pointIndex}`);
        }
      }
    }
    expect([...blockedPathSegments]).toEqual([]);
  });

  it('preserves the approved portrait and generated runtime hashes', () => {
    const portrait = readFileSync('art/atlas/environments/beacon-commons-v1/review-mobile-city.png');
    const manifest = JSON.parse(readFileSync('public/atlas/manifests/assets-v2.json', 'utf8')) as { assets: Array<{ id: string; sha256: string }> };
    expect(createHash('sha256').update(portrait).digest('hex')).toBe('0e063f2d5034f562267ccdabc5ab4082ce59ce1fb3deacaa7c051fc8b7a6ec67');
    for (const asset of manifest.assets.filter((entry) => entry.id.startsWith('atlas-walker-') || entry.id === 'beacon-commons-environment')) {
      const path = `public${asset.id === 'beacon-commons-environment' ? '/atlas/3d/v1/beacon-commons/environment.glb' : `/atlas/3d/v1/characters/${asset.id}.glb`}`;
      expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(asset.sha256.toLowerCase());
    }
  });
});

function animationFrameCount(document: Record<string, any>, clipName: string): number {
  const clip = document.animations.find((candidate: { name?: string }) => candidate.name === clipName);
  expect(clip, `missing animation clip ${clipName}`).toBeDefined();
  return document.accessors[clip.samplers[0].input].count as number;
}

function animationDuration(document: Record<string, any>, clipName: string): number {
  const clip = document.animations.find((candidate: { name?: string }) => candidate.name === clipName);
  expect(clip, `missing animation clip ${clipName}`).toBeDefined();
  return document.accessors[clip.samplers[0].input].max[0] as number;
}
