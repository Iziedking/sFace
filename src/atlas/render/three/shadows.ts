import { CircleGeometry, Mesh, MeshBasicMaterial } from 'three';
import { ATLAS_WORLD_PALETTE } from '../../palette';
import { QUALITY_PROFILES } from '../../../../shared/atlas/city/quality';
import { NO_OUTLINE_FLAG } from './outline';
import type { AtlasQualityTier } from '../../../../shared/atlas/city/types';

export interface AtlasShadowPlan {
  readonly mapEnabled: boolean;
  readonly mapSize: number;
  readonly blobs: boolean;
}

/*
 * The quality profiles have declared 'off' | 'contact' | 'dynamic' since the
 * city landed, and QUALITY_REDUCTION_ORDER lists shadows as the second thing to
 * shed. Nothing ever read either. This turns the declaration into behaviour.
 *
 * 'contact' is a blob: a flat translucent circle under the character. It costs
 * one draw call, needs no shadow pass, and is what mobile games ship. Dropping
 * to it rather than to nothing matters because a character with no shadow does
 * not read as standing on the ground.
 */
export function shadowPlanForTier(tier: AtlasQualityTier): AtlasShadowPlan {
  const mode = QUALITY_PROFILES[tier].shadows;
  return {
    mapEnabled: mode === 'dynamic',
    mapSize: 1024,
    blobs: mode !== 'dynamic',
  };
}

export function createBlobShadow(radius = 0.34): Mesh {
  const blob = new Mesh(
    new CircleGeometry(radius, 12),
    new MeshBasicMaterial({ color: ATLAS_WORLD_PALETTE.ink, transparent: true, opacity: 0.26, depthWrite: false }),
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.01;
  blob.castShadow = false;
  blob.receiveShadow = false;
  blob.renderOrder = -1;
  // An inverted hull around a flat disc is a dark ring the size of the shadow.
  blob.userData[NO_OUTLINE_FLAG] = true;
  return blob;
}
