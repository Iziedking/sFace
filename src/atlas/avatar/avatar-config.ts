import type { AtlasAvatarConfig } from '../../../shared/atlas/types';

const ASSET_KEYS = {
  face: new Set(['face-01', 'face-02', 'face-03']),
  body: new Set(['body-01', 'body-02', 'body-03']),
  skin: new Set(['skin-01', 'skin-02', 'skin-03', 'skin-04', 'skin-05', 'skin-06']),
  hair: new Set(['hair-01', 'hair-02', 'hair-03', 'hair-04', 'hair-05']),
  workwear: new Set(['harbor-01', 'harbor-02', 'builder-01']),
  accessories: new Set(['glasses-01', 'scarf-01', 'satchel-01', 'tool-roll-01']),
} as const;

export const DEFAULT_ATLAS_AVATAR: AtlasAvatarConfig = Object.freeze({
  face: 'face-01',
  body: 'body-01',
  skin: 'skin-01',
  hair: 'hair-01',
  workwear: 'harbor-01',
  accessories: [],
  name: 'Atlas Walker',
  pronouns: 'they/them',
});

export function validateAvatarConfig(value: unknown): AtlasAvatarConfig {
  if (!isRecord(value)) throw new Error('Atlas avatar config must be an object.');
  if ('collisionRadius' in value || 'hitbox' in value || 'collision' in value) throw new Error('Avatar collision cannot be customized.');
  for (const field of ['face', 'body', 'skin', 'hair', 'workwear'] as const) {
    assertAsset(field, value[field]);
  }
  if (!Array.isArray(value.accessories)) throw new Error('Atlas avatar accessories must be an array.');
  const accessories = value.accessories.map((item) => {
    assertAsset('accessories', item);
    return item;
  });
  if (new Set(accessories).size !== accessories.length) throw new Error('Atlas avatar accessories cannot be duplicate.');
  const name = validateText('name', value.name, 40);
  const pronouns = validateText('pronouns', value.pronouns, 24);
  return { face: value.face as string, body: value.body as string, skin: value.skin as string, hair: value.hair as string, workwear: value.workwear as string, accessories, name, pronouns };
}

function assertAsset(field: keyof typeof ASSET_KEYS, value: unknown): void {
  if (typeof value !== 'string' || !ASSET_KEYS[field].has(value as never)) throw new Error(`Atlas avatar ${field} asset is unknown.`);
}

function validateText(field: string, value: unknown, maximum: number): string {
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`Atlas avatar ${field} text is invalid or exceeds length.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
