export const ATLAS_JOYSTICK_DEAD_ZONE = 0.12;
export const ATLAS_INTERACTION_RANGE_METERS = 1.8;
export const ATLAS_FACING_DOT_THRESHOLD = 0.2;

export type AtlasCityInteractionAction = 'talk' | 'inspect' | 'review' | 'pick-up' | 'install' | 'board' | 'travel';

export interface AtlasCityVector2 {
  readonly x: number;
  readonly y: number;
}

export interface AtlasCityTarget {
  readonly id: string;
  readonly action: AtlasCityInteractionAction;
  readonly position: AtlasCityVector2;
  readonly enabled: boolean;
  readonly occluded: boolean;
  readonly facingDot: number;
}

export function applyJoystickDeadZone(input: AtlasCityVector2): AtlasCityVector2 {
  const magnitude = Math.hypot(input.x, input.y);
  if (!Number.isFinite(magnitude) || magnitude <= ATLAS_JOYSTICK_DEAD_ZONE) return { x: 0, y: 0 };
  const scaled = Math.min(1, (magnitude - ATLAS_JOYSTICK_DEAD_ZONE) / (1 - ATLAS_JOYSTICK_DEAD_ZONE));
  return { x: (input.x / magnitude) * scaled, y: (input.y / magnitude) * scaled };
}

export function cameraRelativeJoystick(input: AtlasCityVector2, cameraForward: AtlasCityVector2, cameraRight: AtlasCityVector2): AtlasCityVector2 {
  const normalized = applyJoystickDeadZone(input);
  return {
    x: clamp(normalized.x * cameraRight.x + normalized.y * cameraForward.x),
    y: clamp(normalized.x * cameraRight.y + normalized.y * cameraForward.y),
  };
}

export function chooseEligibleInteraction(player: AtlasCityVector2, targets: readonly AtlasCityTarget[]): AtlasCityTarget | null {
  return targets
    .filter((target) => target.enabled && !target.occluded && target.facingDot >= ATLAS_FACING_DOT_THRESHOLD && distance(player, target.position) <= ATLAS_INTERACTION_RANGE_METERS)
    .sort((left, right) => distance(player, left.position) - distance(player, right.position) || left.id.localeCompare(right.id))[0] ?? null;
}

function distance(left: AtlasCityVector2, right: AtlasCityVector2): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function clamp(value: number): number {
  return Math.max(-1, Math.min(1, value));
}
