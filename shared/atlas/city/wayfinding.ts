export type AtlasWaypointDirection = 'ready' | 'ahead' | 'left' | 'right' | 'behind';

export interface AtlasWaypointGuidance {
  readonly distanceMeters: number;
  readonly relativeBearingRadians: number;
  readonly direction: AtlasWaypointDirection;
  readonly arrow: string;
}

export interface AtlasWaypointPosition {
  readonly x: number;
  readonly z: number;
}

export function getAtlasWaypointGuidance(
  player: AtlasWaypointPosition & { readonly headingRadians: number },
  target: AtlasWaypointPosition,
  arrivalRadius = 2.4,
): AtlasWaypointGuidance {
  const deltaX = target.x - player.x;
  const deltaZ = target.z - player.z;
  const distanceMeters = Math.hypot(deltaX, deltaZ);
  const bearingRadians = Math.atan2(deltaX, deltaZ);
  const relativeBearingRadians = normalizeAngle(bearingRadians - player.headingRadians);
  if (distanceMeters <= arrivalRadius) return { distanceMeters, relativeBearingRadians, direction: 'ready', arrow: '•' };
  if (Math.abs(relativeBearingRadians) <= 0.38) return { distanceMeters, relativeBearingRadians, direction: 'ahead', arrow: '↑' };
  if (Math.abs(relativeBearingRadians) >= 2.76) return { distanceMeters, relativeBearingRadians, direction: 'behind', arrow: '↓' };
  return relativeBearingRadians < 0
    ? { distanceMeters, relativeBearingRadians, direction: 'right', arrow: '↗' }
    : { distanceMeters, relativeBearingRadians, direction: 'left', arrow: '↖' };
}

function normalizeAngle(value: number): number {
  return Math.atan2(Math.sin(value), Math.cos(value));
}
