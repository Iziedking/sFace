import type { AtlasCitySceneV1 } from '../../../shared/atlas/city/types';
import type { AtlasCityPlayerState } from '../../../shared/atlas/city/player';
import type { AtlasCityInteractionPresentation } from './contracts';
import type { AtlasCitizenPresentation } from '../../../shared/atlas/city/crowd';
import { BEACON_COMMONS_CROWD } from '../../../shared/atlas/city/crowd';
import { projectAtlasCitizenMotion } from '../../../shared/atlas/city/citizen-motion';

export interface CityMapPainter {
  rect(x: number, y: number, width: number, height: number, color: number): void;
  circle(x: number, y: number, radius: number, color: number): void;
  line(points: readonly [number, number][], width: number, color: number): void;
}

// Shared geometry for both lightweight renderers: identical walkable streets,
// collision footprints, player coordinates and objectives to the 3D city.
export function paintCityMap(painter: CityMapPainter, scene: AtlasCitySceneV1, width: number, height: number, player: AtlasCityPlayerState, restored: boolean, interaction?: AtlasCityInteractionPresentation, crowd: readonly AtlasCitizenPresentation[] = [], elapsedSeconds = 0): void {
  const overview = interaction?.cameraMode === 'overview';
  const scale = Math.min(width / (overview ? 28 : 14), height / (overview ? 36 : 18));
  const angle = player.cameraHeadingRadians - Math.PI;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const point = (x: number, z: number): [number, number] => {
    const dx = x - player.x;
    const dz = z - player.z;
    return [width / 2 + (dx * cosine - dz * sine) * scale, height * 0.55 + (dx * sine + dz * cosine) * scale];
  };
  painter.rect(0, 0, width, height, 0x638f8a);
  for (const path of scene.paths) painter.line(path.points.map(p => point(p[0], p[2])), Math.max(3, scale * 0.7), 0xdedbc1);
  for (const collider of scene.colliders) {
    const [x, , z] = collider.position;
    const halfX = collider.size[0] / 2;
    const halfZ = collider.size[2] / 2;
    painter.line([point(x-halfX, z-halfZ), point(x+halfX, z-halfZ), point(x+halfX, z+halfZ), point(x-halfX, z+halfZ), point(x-halfX, z-halfZ)], Math.max(4, scale * 0.2), 0x203e48);
  }
  for (const citizen of crowd) {
    if (!citizen.visible) continue;
    const definition = BEACON_COMMONS_CROWD.find(candidate => candidate.id === citizen.id);
    const anchor = scene.anchors.find(candidate => candidate.id === definition?.spawnAnchorId);
    const path = scene.paths.find(candidate => candidate.id === citizen.pathId);
    if (!anchor) continue;
    const motion = path ? projectAtlasCitizenMotion({ active: citizen.active, activity: citizen.activity, elapsedSeconds, phase: citizen.animationPhase, path, spawn: anchor.position }) : null;
    const position = motion?.position ?? anchor.position;
    const p = point(position[0], position[2]);
    painter.circle(p[0], p[1], 3, restored ? 0xffd76c : 0x183b4a);
  }
  const target = scene.anchors.find(a => a.id === interaction?.targetAnchorId);
  if (target) {
    const p = point(target.position[0], target.position[2]);
    painter.circle(p[0], p[1], 12, restored ? 0xffd76c : 0xe83578);
    painter.circle(p[0], p[1], 6, 0xf7f1da);
  }
  const p = point(player.x, player.z);
  painter.circle(p[0], p[1], 10, 0xf7f1da);
  painter.circle(p[0], p[1], 6, 0x173e50);
  const ahead = point(player.x + Math.sin(player.headingRadians) * 0.6, player.z + Math.cos(player.headingRadians) * 0.6);
  painter.line([p, ahead], 4, 0xe83578);
}
