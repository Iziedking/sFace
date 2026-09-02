import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { AtlasCameraRig, nearestCameraObstructionDistance } from '../src/atlas/render/three/camera-rig';

describe('Atlas mobile camera rig', () => {
  it('locks the approved close portrait framing values', () => {
    const camera = new PerspectiveCamera();
    const rig = new AtlasCameraRig(camera);
    expect(rig.fieldOfViewDegrees).toBe(60);
    expect(rig.targetPlayerScreenHeightPercent).toBe(0.28);
    expect(rig.followDistanceMeters).toBe(4.75);
    expect(camera.fov).toBe(60);
    expect(camera.position.x).toBeCloseTo(0.52);
    expect(camera.position.y).toBeCloseTo(2.62);
    expect(camera.position.z).toBeCloseTo(8.95);
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
    expect(camera.fov).toBeGreaterThan(62);
    expect(camera.position.x).toBeLessThan(0);
    expect(camera.position.z).toBeGreaterThan(0);
  });

  it('damps movement FOV so a short movement tap cannot pulse the camera', () => {
    const camera = new PerspectiveCamera();
    const rig = new AtlasCameraRig(camera);
    rig.update({ width: 390, height: 844, deltaSeconds: 1 / 60, playerMoving: true });
    const firstMovingFrame = camera.fov;
    expect(firstMovingFrame).toBeGreaterThan(60);
    expect(firstMovingFrame).toBeLessThan(60.25);
    rig.update({ width: 390, height: 844, deltaSeconds: 1 / 60, playerMoving: false });
    expect(camera.fov).toBeGreaterThan(60);
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
    expect(camera.position.x).toBeCloseTo(0.52, 1);
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
