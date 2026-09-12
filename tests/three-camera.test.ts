import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  ATLAS_FRAMING_BAND,
  AtlasCameraRig,
  nearestCameraObstructionDistance,
  projectedAtlasScreenHeightPercent,
  solveAtlasFollowGeometry,
  atlasFramingTargetPercent,
  ATLAS_FRAMING_MIN_PERCENT,
  ATLAS_FRAMING_MAX_PERCENT,
} from '../src/atlas/render/three/camera-rig';

describe('Atlas mobile camera rig', () => {
  it('derives its follow geometry from the approved framing goal', () => {
    const camera = new PerspectiveCamera();
    const rig = new AtlasCameraRig(camera);
    expect(rig.targetPlayerScreenHeightPercent).toBeGreaterThanOrEqual(ATLAS_FRAMING_BAND.minimum);
    expect(rig.targetPlayerScreenHeightPercent).toBeLessThanOrEqual(ATLAS_FRAMING_BAND.maximum);
    expect(camera.fov).toBe(rig.fieldOfViewDegrees);
    const solved = solveAtlasFollowGeometry({
      avatarHeightMeters: rig.avatarHeightMeters,
      targetScreenHeightPercent: rig.targetPlayerScreenHeightPercent,
      fieldOfViewDegrees: rig.fieldOfViewDegrees,
      pitchDegrees: rig.pitchDegrees,
    });
    expect(rig.followDistanceMeters).toBeCloseTo(solved.followDistanceMeters, 6);
    expect(rig.cameraLiftMeters).toBeCloseTo(solved.cameraLiftMeters, 6);
    expect(rig.cameraHeightMeters).toBeCloseTo(rig.aimHeightMeters + solved.cameraLiftMeters, 6);
  });

  it('sits further back and higher than the rejected close framing', () => {
    const rig = new AtlasCameraRig(new PerspectiveCamera());
    expect(rig.followDistanceMeters).toBeGreaterThan(4.75);
    expect(rig.cameraHeightMeters).toBeGreaterThan(2.62);
    expect(rig.lookAheadMeters).toBeLessThan(4.1);
    expect(rig.fieldOfViewDegrees).toBeLessThan(60);
  });

  it('stays behind the player and looks ahead in the facing direction', () => {
    const camera = new PerspectiveCamera();
    const rig = new AtlasCameraRig(camera);
    const player = new Vector3(2, 0, 1);
    for (let index = 0; index < 12; index += 1) {
      rig.update({ width: 390, height: 844, deltaSeconds: 1 / 30, playerPosition: player, playerFacing: 'right', playerMoving: true });
    }
    const playerToCamera = camera.position.clone().sub(player);
    expect(playerToCamera.x).toBeLessThan(0);
    const viewDirection = new Vector3();
    camera.getWorldDirection(viewDirection);
    expect(viewDirection.x).toBeGreaterThan(0.75);
  });

  it('turns smoothly instead of snapping when the player changes direction', () => {
    const camera = new PerspectiveCamera();
    const rig = new AtlasCameraRig(camera);
    const before = camera.position.clone();
    rig.update({ width: 390, height: 844, deltaSeconds: 1 / 60, playerFacing: 'left', playerMoving: true });
    const afterOneFrame = camera.position.clone();
    expect(afterOneFrame.equals(before)).toBe(false);
    expect(afterOneFrame.x).toBeGreaterThan(-4.2);
    for (let index = 0; index < 30; index += 1) {
      rig.update({ width: 390, height: 844, deltaSeconds: 1 / 60, playerFacing: 'left', playerMoving: true });
    }
    expect(camera.position.x).toBeGreaterThan(4.2);
  });

  it('tracks a continuous analog heading and widens slightly while running', () => {
    const camera = new PerspectiveCamera();
    const rig = new AtlasCameraRig(camera);
    for (let index = 0; index < 30; index += 1) {
      rig.update({ width: 844, height: 390, deltaSeconds: 1 / 60, playerHeadingRadians: Math.PI * 0.75, playerMoving: true, playerRunning: true });
    }
    expect(camera.fov).toBeGreaterThan(rig.fieldOfViewDegrees + 2);
    expect(camera.position.x).toBeLessThan(0);
    expect(camera.position.z).toBeGreaterThan(0);
  });

  it('damps movement FOV so a short movement tap cannot pulse the camera', () => {
    const camera = new PerspectiveCamera();
    const rig = new AtlasCameraRig(camera);
    rig.update({ width: 390, height: 844, deltaSeconds: 1 / 60, playerMoving: true });
    const firstMovingFrame = camera.fov;
    expect(firstMovingFrame).toBeGreaterThan(rig.fieldOfViewDegrees);
    expect(firstMovingFrame).toBeLessThan(rig.fieldOfViewDegrees + 0.25);
    rig.update({ width: 390, height: 844, deltaSeconds: 1 / 60, playerMoving: false });
    expect(camera.fov).toBeGreaterThan(rig.fieldOfViewDegrees);
    expect(firstMovingFrame - camera.fov).toBeLessThan(0.08);
  });

  it('uses time-based damping and shortens the camera arm for an obstruction', () => {
    const camera = new PerspectiveCamera();
    const rig = new AtlasCameraRig(camera);
    const player = new Vector3(0, 0, 4.2);
    const unobstructed = camera.position.distanceTo(player);
    for (let index = 0; index < 8; index += 1) {
      rig.update({ width: 390, height: 844, deltaSeconds: 1 / 30, playerPosition: player, obstructionDistance: 2.2 });
    }
    expect(camera.position.distanceTo(player)).toBeLessThan(unobstructed);
  });

  it('keeps the camera on the street side when a building blocks the follow arm', () => {
    const camera = new PerspectiveCamera();
    const rig = new AtlasCameraRig(camera);
    const player = new Vector3(0, 0, 4.2);
    const buildingBehindPlayer = {
      id: 'camera-wall',
      shape: 'box' as const,
      position: [0, 1.6, 6.5] as const,
      size: [4, 3.2, 1] as const,
    };
    rig.update({
      width: 844,
      height: 390,
      deltaSeconds: 1 / 60,
      playerPosition: player,
      cameraHeadingRadians: Math.PI,
      colliders: [buildingBehindPlayer],
    });
    const pivot = player.clone();
    pivot.y += 1.42;
    expect(nearestCameraObstructionDistance(pivot, camera.position, [buildingBehindPlayer])).toBeUndefined();
    expect(camera.position.distanceTo(player)).toBeGreaterThan(0.4);
  });

  it('moves around a close wall instead of filling the view with it', () => {
    const camera = new PerspectiveCamera();
    const rig = new AtlasCameraRig(camera);
    const player = new Vector3(0, 0, 4.2);
    const wall = { id: 'camera-wall', shape: 'box' as const, position: [0, 1.6, 6.5] as const, size: [4, 3.2, 1] as const };
    for (let index = 0; index < 30; index += 1) {
      rig.update({ width: 390, height: 844, deltaSeconds: 1 / 60, playerPosition: player, cameraHeadingRadians: Math.PI, colliders: [wall] });
    }
    const pivot = player.clone();
    pivot.y += 1.42;
    expect(camera.position.distanceTo(pivot)).toBeGreaterThan(2.4);
    expect(Math.abs(camera.position.x)).toBeGreaterThan(1.2);
  });

  it('restores the full follow arm after the building is no longer behind the player', () => {
    const camera = new PerspectiveCamera();
    const rig = new AtlasCameraRig(camera);
    const player = new Vector3(0, 0, 4.2);
    const wall = { id: 'camera-wall', shape: 'box' as const, position: [0, 1.6, 6.5] as const, size: [4, 3.2, 1] as const };
    for (let index = 0; index < 24; index += 1) {
      rig.update({ width: 390, height: 844, deltaSeconds: 1 / 60, playerPosition: player, cameraHeadingRadians: Math.PI, colliders: [wall] });
    }
    for (let index = 0; index < 45; index += 1) {
      rig.update({ width: 390, height: 844, deltaSeconds: 1 / 60, playerPosition: player, cameraHeadingRadians: Math.PI, colliders: [] });
    }
    const pivot = player.clone();
    pivot.y += 1.42;
    expect(camera.position.distanceTo(pivot)).toBeGreaterThan(4.5);
    expect(camera.position.x).toBeCloseTo(0, 1);
  });

  it('preserves portrait projection across safe resize bounds', () => {
    const camera = new PerspectiveCamera();
    const rig = new AtlasCameraRig(camera);
    rig.resize(390, 844);
    expect(camera.aspect).toBeCloseTo(390 / 844);
    rig.resize(0, 0);
    expect(camera.aspect).toBe(1);
  });
});

/*
 * Framing solver. The rig previously accepted targetPlayerScreenHeightPercent,
 * defaulted it to 0.28, exposed it as a readonly field, and never read it in
 * update(). A test asserted the field equalled 0.28 and passed green while
 * proving nothing about what a player sees. These tests pin the projected
 * result instead of the stored input, so the framing goal cannot go dead again.
 *
 * The avatar is 1.76 m in art/atlas/characters/atlas-walker-v1/character-spec.json
 * scaled by PLAYER_WORLD_SCALE 0.72 in three-renderer.ts, so it stands
 * 1.2672 m in world space.
 */
describe('Atlas camera framing solver', () => {
  const AVATAR_HEIGHT_METERS = 1.76 * 0.72;

  it('solves a follow geometry that projects the avatar at the requested screen height', () => {
    const geometry = solveAtlasFollowGeometry({
      avatarHeightMeters: AVATAR_HEIGHT_METERS,
      targetScreenHeightPercent: 0.175,
      fieldOfViewDegrees: 52,
      pitchDegrees: 31,
    });
    const projected = projectedAtlasScreenHeightPercent({
      avatarHeightMeters: AVATAR_HEIGHT_METERS,
      slantDistanceMeters: geometry.slantDistanceMeters,
      fieldOfViewDegrees: 52,
    });
    expect(projected).toBeCloseTo(0.175, 4);
  });

  it('decomposes the slant distance into a follow distance and a camera lift for the requested pitch', () => {
    const geometry = solveAtlasFollowGeometry({
      avatarHeightMeters: AVATAR_HEIGHT_METERS,
      targetScreenHeightPercent: 0.175,
      fieldOfViewDegrees: 52,
      pitchDegrees: 31,
    });
    const pitchRadians = Math.atan2(geometry.cameraLiftMeters, geometry.followDistanceMeters);
    expect((pitchRadians * 180) / Math.PI).toBeCloseTo(31, 3);
    expect(Math.hypot(geometry.followDistanceMeters, geometry.cameraLiftMeters)).toBeCloseTo(geometry.slantDistanceMeters, 6);
  });

  it('pulls the camera back rather than forward compared with the rejected close framing', () => {
    const geometry = solveAtlasFollowGeometry({
      avatarHeightMeters: AVATAR_HEIGHT_METERS,
      targetScreenHeightPercent: 0.175,
      fieldOfViewDegrees: 52,
      pitchDegrees: 31,
    });
    expect(geometry.followDistanceMeters).toBeGreaterThan(4.75);
  });

  it('frames the avatar inside the approved band on a 390x844 portrait viewport', () => {
    const camera = new PerspectiveCamera();
    const rig = new AtlasCameraRig(camera, { avatarHeightMeters: AVATAR_HEIGHT_METERS });
    const player = new Vector3(0, 0, 4.2);
    for (let index = 0; index < 60; index += 1) {
      rig.update({ width: 390, height: 844, deltaSeconds: 1 / 60, playerPosition: player, cameraHeadingRadians: Math.PI });
    }
    const projected = projectedAtlasScreenHeightPercent({
      avatarHeightMeters: AVATAR_HEIGHT_METERS,
      slantDistanceMeters: camera.position.distanceTo(new Vector3(player.x, player.y + AVATAR_HEIGHT_METERS / 2, player.z)),
      fieldOfViewDegrees: camera.fov,
    });
    expect(projected).toBeGreaterThanOrEqual(0.16);
    expect(projected).toBeLessThanOrEqual(0.19);
  });

  it('aims at the avatar body rather than above its head', () => {
    const rig = new AtlasCameraRig(new PerspectiveCamera(), { avatarHeightMeters: AVATAR_HEIGHT_METERS });
    expect(rig.aimHeightMeters).toBeLessThan(AVATAR_HEIGHT_METERS);
    expect(rig.aimHeightMeters).toBeGreaterThan(AVATAR_HEIGHT_METERS * 0.5);
  });

  it('holds the framing band on a narrower viewport, because vertical field of view is aspect independent', () => {
    const camera = new PerspectiveCamera();
    const rig = new AtlasCameraRig(camera, { avatarHeightMeters: AVATAR_HEIGHT_METERS });
    const player = new Vector3(0, 0, 4.2);
    for (let index = 0; index < 60; index += 1) {
      rig.update({ width: 320, height: 700, deltaSeconds: 1 / 60, playerPosition: player, cameraHeadingRadians: Math.PI });
    }
    const projected = projectedAtlasScreenHeightPercent({
      avatarHeightMeters: AVATAR_HEIGHT_METERS,
      slantDistanceMeters: camera.position.distanceTo(new Vector3(player.x, player.y + AVATAR_HEIGHT_METERS / 2, player.z)),
      fieldOfViewDegrees: camera.fov,
    });
    expect(projected).toBeGreaterThanOrEqual(0.16);
    expect(projected).toBeLessThanOrEqual(0.19);
  });
});

describe('landscape framing', () => {
  /*
   * Measured on a Pixel 7 Pro: the avatar was 162 px tall in portrait (923 px
   * viewport) and 70 px in landscape (401 px), because the solve targets a
   * fraction of viewport height and the camera sat at the same 6.27 m in both.
   * Proportionally identical, 43 percent of the size, and too small to read.
   */
  it('leaves portrait exactly as it was tuned', () => {
    expect(atlasFramingTargetPercent(923)).toBeCloseTo(ATLAS_FRAMING_MIN_PERCENT, 5);
    expect(atlasFramingTargetPercent(2000)).toBeCloseTo(ATLAS_FRAMING_MIN_PERCENT, 5);
  });

  it('gives a short landscape viewport a larger share of its height', () => {
    expect(atlasFramingTargetPercent(401)).toBeGreaterThan(atlasFramingTargetPercent(923));
    // 30 percent of 401 px is 120 px, against 70 px before.
    expect(atlasFramingTargetPercent(401) * 401).toBeGreaterThan(110);
  });

  it('never pushes the camera further than the ceiling allows', () => {
    for (const height of [1, 50, 200, 401]) {
      expect(atlasFramingTargetPercent(height)).toBeLessThanOrEqual(ATLAS_FRAMING_MAX_PERCENT);
    }
  });

  it('falls back to the tuned value on nonsense input', () => {
    for (const height of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(atlasFramingTargetPercent(height)).toBe(ATLAS_FRAMING_MIN_PERCENT);
    }
  });

  it('never shrinks the avatar as the viewport grows', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (const height of [300, 401, 500, 700, 900, 1200]) {
      const target = atlasFramingTargetPercent(height);
      expect(target).toBeLessThanOrEqual(previous);
      previous = target;
    }
  });
});
