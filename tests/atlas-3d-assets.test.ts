import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseAtlasAssetManifest } from '../src/atlas/assets/manifest';
import { isAtlasCitizenPositionBlocked } from '../shared/atlas/city/citizen-motion';
import { createAtlasCityPlayer, stepAtlasCityPlayer } from '../shared/atlas/city/player';
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
    expect(manifest.assets.length).toBe(14);
    expect(manifest.assets.filter((asset) => asset.mime === 'model/gltf-binary')).toHaveLength(8);
  });

  it('keeps procedural approval separate from rejected references', () => {
    const records = JSON.parse(readFileSync('art/atlas/licenses.json', 'utf8')) as Array<{ id: string; status: string; sourceFile: string }>;
    expect(records.find((record) => record.id === 'atlas-walker-v1-procedural')).toMatchObject({
      status: 'owner-approved-procedural',
      sourceFile: 'art/atlas/characters/atlas-walker-v1/build_character.py',
    });
    expect(records.find((record) => record.id === 'atlas-walker-v2-procedural')).toMatchObject({
      status: 'owner-approved-procedural',
      sourceFile: 'art/atlas/characters/atlas-walker-v2/build_character.py',
    });
    expect(records.find((record) => record.id === 'avatar-sheet')).toMatchObject({ status: 'rejected-reference' });
    expect(records.filter((record) => record.status === 'owner-approved-procedural')).toHaveLength(3);
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

  it('ships dedicated authored idle, walk, run, and conversation clips', () => {
    const player = readGlbJson('public/atlas/3d/v1/characters/atlas-walker-player.glb');
    expect(player.animations.map((clip: { name: string }) => clip.name)).toEqual(['Atlas_Idle', 'Atlas_Walk', 'Atlas_Run', 'Atlas_Talk']);
    expect(player.nodes.map((node: { name: string }) => node.name)).toEqual(expect.arrayContaining(['eye.L', 'eye.R', 'eyelid.L', 'eyelid.R', 'mouth']));
    expect(animationFrameCount(player, 'Atlas_Idle')).toBeGreaterThanOrEqual(13);
    expect(animationFrameCount(player, 'Atlas_Walk')).toBeGreaterThanOrEqual(25);
    expect(animationDuration(player, 'Atlas_Walk')).toBeCloseTo(1.2, 2);
    expect(animationFrameCount(player, 'Atlas_Run')).toBeGreaterThanOrEqual(13);
    expect(animationFrameCount(player, 'Atlas_Talk')).toBeGreaterThanOrEqual(17);
    expect(animationDuration(player, 'Atlas_Talk')).toBeCloseTo(2, 2);
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
    expect([...animatedNodes(player, 'Atlas_Talk')]).toEqual(
      expect.arrayContaining(['hips', 'chest', 'neck', 'head', 'upper_arm.L', 'lower_arm.L', 'upper_arm.R', 'lower_arm.R']),
    );
  });

  /*
   * v2 is staged, not shipped. The districts still load /atlas/3d/v1/, so the
   * block above stays exactly as it is and guards what users actually get.
   * These cover the replacement until it has been seen on a device.
   */
  it('holds the staged v2 character and its LODs to their own budgets', () => {
    const player = readGlbJson('public/atlas/3d/v2/characters/atlas-walker-v2-player.glb');
    const lod1 = readGlbJson('public/atlas/3d/v2/characters/atlas-walker-v2-lod1.glb');
    const lod2 = readGlbJson('public/atlas/3d/v2/characters/atlas-walker-v2-lod2.glb');
    expect(triangleCount(player)).toBeLessThanOrEqual(12000);
    expect(triangleCount(player)).toBeGreaterThan(8000);
    expect(triangleCount(lod1)).toBeLessThanOrEqual(3300);
    expect(triangleCount(lod2)).toBeLessThanOrEqual(800);
    // The renderer swaps detail level mid-stride, so every level needs the
    // whole skeleton and the whole clip set or the swap throws.
    for (const level of [player, lod1, lod2]) {
      expect(level.skins[0].joints).toHaveLength(23);
      expect(level.animations).toHaveLength(4);
      expect(level.images).toBeUndefined();
      expect(level.textures).toBeUndefined();
    }
  });

  it('gives the staged v2 character an identity rest rotation on every bone', () => {
    /*
     * character-gait-rig.ts sets leg rotations absolutely, not relative to the
     * rest pose: `blendRotation(leg.upper, pose.hip, 0, 0, amount)`. A bone
     * that rests at anything but identity therefore has that rest thrown away
     * the moment the player moves. The first v2 build aimed each bone's tail
     * at its children, which gave upper_leg and upper_arm a 180 degree rest
     * rotation, and both legs would have snapped upright on the first step.
     */
    const player = readGlbJson('public/atlas/3d/v2/characters/atlas-walker-v2-player.glb');
    const skinned = new Set<number>(player.skins[0].joints as number[]);
    const offenders = (player.nodes as Array<{ name?: string; rotation?: number[] }>)
      .filter((node, index) => skinned.has(index) && node.rotation !== undefined)
      .filter((node) => Math.hypot(node.rotation![0], node.rotation![1], node.rotation![2]) > 1e-4)
      .map((node) => node.name);
    expect(offenders).toEqual([]);
  });

  it('bakes all four v2 clips over the same bones, so none inherits a stale pose', () => {
    /*
     * A clip that omits a bone does not leave it at rest, it leaves it wherever
     * the previous clip put it. Atlas_Talk originally skipped the legs and
     * shipped standing in a full walking stride, so every clip now keys the
     * same set.
     */
    const player = readGlbJson('public/atlas/3d/v2/characters/atlas-walker-v2-player.glb');
    expect([...player.animations.map((clip: { name: string }) => clip.name)].sort()).toEqual(
      ['Atlas_Idle', 'Atlas_Run', 'Atlas_Talk', 'Atlas_Walk'],
    );
    const locomotion = ['hips', 'chest', 'upper_arm.L', 'lower_arm.L', 'upper_arm.R', 'lower_arm.R', 'upper_leg.L', 'lower_leg.L', 'foot.L', 'upper_leg.R', 'lower_leg.R', 'foot.R'];
    for (const clipName of ['Atlas_Idle', 'Atlas_Walk', 'Atlas_Run', 'Atlas_Talk']) {
      expect([...animatedNodes(player, clipName)]).toEqual(expect.arrayContaining(locomotion));
    }
    expect(animationDuration(player, 'Atlas_Walk')).toBeCloseTo(1.21, 1);
    expect(animationDuration(player, 'Atlas_Talk')).toBeCloseTo(2, 2);
    expect(animationKeyframePeak(player, 'Atlas_Walk')).toBeGreaterThanOrEqual(25);
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

  it('keeps the evidence marker on walkable ground in front of a solid community board', () => {
    const scene = parseAtlasCityScene(JSON.parse(readFileSync('public/atlas/3d/v1/beacon-commons/scene.json', 'utf8')));
    const evidence = scene.anchors.find((anchor) => anchor.id === 'community-plaza');
    const board = scene.colliders.find((collider) => collider.id === 'obstruction-community-board');
    expect(evidence).toBeDefined();
    expect(board).toMatchObject({ shape: 'box', position: [-2.9, 0.825, -5.6], size: [2.3, 1.65, 0.18] });
    expect(isAtlasCitizenPositionBlocked({ x: evidence!.position[0], z: evidence!.position[2] }, scene.colliders)).toBe(false);
    expect(evidence!.position[2]).toBeGreaterThan(board!.position[2] + board!.size[2] / 2);
  });

  it('stops the player at the visible community board while keeping the evidence reachable', () => {
    const scene = parseAtlasCityScene(JSON.parse(readFileSync('public/atlas/3d/v1/beacon-commons/scene.json', 'utf8')));
    expect(scene.navigation).toBeDefined();
    const navigation = scene.navigation!;
    let player = createAtlasCityPlayer({ x: -2.9, z: -4.6, facing: 'up' });
    for (let frame = 0; frame < 30; frame += 1) {
      player = stepAtlasCityPlayer(player, { moveX: 0, moveY: -127 }, 0.1, navigation.bounds, scene.colliders, {
        x: navigation.safeSpawn[0],
        z: navigation.safeSpawn[2],
      });
    }
    expect(player.z).toBeLessThan(-4.6);
    expect(player.z).toBeGreaterThan(-5.18);
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

  /*
   * A phone play test reported walking straight through Pay Harbor. It had four
   * colliders against Beacon Commons' thirty-one, so most of what the build
   * script authors as solid was not solid.
   *
   * Both halves are asserted, because fixing one by breaking the other is the
   * easy mistake: a collider that swallows an anchor turns a cosmetic bug into
   * an objective the player cannot reach, and neither failure throws.
   */
  it.each([
    ['pay-harbor', 12],
    ['beacon-commons', 31],
  ])('makes %s solid without sealing any objective inside a wall', (district, minimumColliders) => {
    const scene = parseAtlasCityScene(JSON.parse(readFileSync(`public/atlas/3d/v1/${district}/scene.json`, 'utf8')));
    expect(scene.colliders.length).toBeGreaterThanOrEqual(minimumColliders);

    const PLAYER_RADIUS = 0.3;
    const unreachable: string[] = [];
    for (const anchor of scene.anchors) {
      for (const collider of scene.colliders) {
        const halfX = collider.size[0] / 2;
        const halfZ = collider.size[2] / 2;
        const offsetX = Math.abs(anchor.position[0] - collider.position[0]);
        const offsetZ = Math.abs(anchor.position[2] - collider.position[2]);
        if (offsetX >= halfX || offsetZ >= halfZ) continue;
        // Inside a solid is fine only while the player can stand outside it and
        // still be within the anchor's radius.
        const clearance = Math.min(halfX - offsetX, halfZ - offsetZ);
        if (clearance + PLAYER_RADIUS > (anchor.radius ?? 0.8)) unreachable.push(`${anchor.id} inside ${collider.id}`);
      }
    }
    expect(unreachable).toEqual([]);
  });

  it.each(['pay-harbor', 'beacon-commons'])('spawns no %s citizen inside a building', (district) => {
    const scene = parseAtlasCityScene(JSON.parse(readFileSync(`public/atlas/3d/v1/${district}/scene.json`, 'utf8')));
    const stuck = scene.anchors
      .filter((anchor) => anchor.id.startsWith('npc-spawn-'))
      .filter((anchor) => isAtlasCitizenPositionBlocked({ x: anchor.position[0], z: anchor.position[2] }, scene.colliders))
      .map((anchor) => anchor.id);
    expect(stuck).toEqual([]);
  });

  it('preserves the approved portrait and generated runtime hashes', () => {
    const portrait = readFileSync('art/atlas/environments/beacon-commons-v1/review-mobile-city.png');
    const manifest = JSON.parse(readFileSync('public/atlas/manifests/assets-v2.json', 'utf8')) as { assets: Array<{ id: string; path: string; sha256: string }> };
    expect(createHash('sha256').update(portrait).digest('hex')).toBe('0e063f2d5034f562267ccdabc5ab4082ce59ce1fb3deacaa7c051fc8b7a6ec67');
    for (const asset of manifest.assets.filter((entry) => entry.id.startsWith('atlas-walker-') || entry.id === 'beacon-commons-environment')) {
      expect(createHash('sha256').update(readFileSync(`public${asset.path}`)).digest('hex')).toBe(asset.sha256.toLowerCase());
    }
  });
});

function animationFrameCount(document: Record<string, any>, clipName: string): number {
  const clip = document.animations.find((candidate: { name?: string }) => candidate.name === clipName);
  expect(clip, `missing animation clip ${clipName}`).toBeDefined();
  return document.accessors[clip.samplers[0].input].count as number;
}

function animationKeyframePeak(document: Record<string, any>, clipName: string): number {
  const clip = document.animations.find((candidate: { name?: string }) => candidate.name === clipName);
  expect(clip, `missing animation clip ${clipName}`).toBeDefined();
  return Math.max(...clip.samplers.map((sampler: { input: number }) => document.accessors[sampler.input].count as number));
}

function animationDuration(document: Record<string, any>, clipName: string): number {
  const clip = document.animations.find((candidate: { name?: string }) => candidate.name === clipName);
  expect(clip, `missing animation clip ${clipName}`).toBeDefined();
  return document.accessors[clip.samplers[0].input].max[0] as number;
}
