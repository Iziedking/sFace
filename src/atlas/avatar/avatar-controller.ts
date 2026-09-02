import type { AtlasAvatarConfig } from '../../../shared/atlas/types';
import { validateAvatarConfig } from './avatar-config';

export type AtlasAvatarDirection = 'up' | 'down' | 'left' | 'right';
export type AtlasAvatarAction = 'none' | 'scanner' | 'relay-tether' | 'shield-pulse';

export interface AtlasAvatarAnimationContext {
  moving: boolean;
  action: AtlasAvatarAction;
  reducedMotion: boolean;
}

export interface AtlasAvatarAnimation {
  family: 'idle' | 'walk' | 'scanner' | 'relay-tether' | 'shield-pulse';
  direction: AtlasAvatarDirection;
  frameIndex: number;
  pose: 'full' | 'reduced-motion';
}

export interface AtlasAvatarSnapshot {
  tick: number;
  player: { facing: AtlasAvatarDirection };
}

export class AtlasAvatarController {
  readonly config: AtlasAvatarConfig;

  constructor(config: unknown) {
    this.config = validateAvatarConfig(config);
  }

  animation(snapshot: AtlasAvatarSnapshot, context: AtlasAvatarAnimationContext): AtlasAvatarAnimation {
    return selectAvatarAnimation(snapshot, context);
  }
}

export function selectAvatarAnimation(snapshot: AtlasAvatarSnapshot, context: AtlasAvatarAnimationContext): AtlasAvatarAnimation {
  const family = context.action === 'none' ? (context.moving ? 'walk' : 'idle') : context.action;
  const frameIndex = context.reducedMotion ? 0 : context.moving ? Math.floor(snapshot.tick / 5) % 6 : Math.floor(snapshot.tick / 12) % 4;
  return { family, direction: snapshot.player.facing, frameIndex, pose: context.reducedMotion ? 'reduced-motion' : 'full' };
}
