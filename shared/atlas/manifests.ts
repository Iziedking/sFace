import { createPublishedManifest } from './content-hash';
import type { AtlasDistrictId, AtlasManifestKind, AtlasPublishedManifest } from './types';
import { ATLAS_LOCAL_TEST_SHOP_ITEM, ATLAS_MAINNET_SHOP_ITEMS } from './shop';

export const ATLAS_CAMPAIGN_CONTENT = {
  id: 'nim-atlas',
  title: 'NIM Atlas',
  openingAdventureId: 'last-lantern',
  districtIds: ['genesis-garden', 'light-forest', 'pay-harbor', 'albatross-causeway', 'validator-peaks', 'builder-city'] as AtlasDistrictId[],
  ruleset: 'atlas-evergreen-v2',
};

const ATLAS_ADVENTURE_CONTENT = {
  id: 'last-lantern',
  title: 'The Last Lantern',
  districtId: 'pay-harbor' as AtlasDistrictId,
  roles: ['explorer', 'builder'],
  knowledgeFragmentIds: ['ask', 'check', 'approve', 'confirm', 'unlock'],
};

const ATLAS_KNOWLEDGE_CONTENT = {
  fragments: [
    { id: 'ask', title: 'Ask', summary: 'A Mini App asks for only the capability the next action needs.', source: 'https://nimiq.dev/mini-apps/' },
    { id: 'check', title: 'Check', summary: 'Review recipient, network, and integer Lunas before approval.', source: 'https://nimiq.dev/mini-apps/api-reference/nimiq-provider' },
    { id: 'approve', title: 'Approve', summary: 'A wallet approval is a user decision, not proof of settlement.', source: 'https://nimiq.dev/mini-apps/api-reference/nimiq-provider' },
    { id: 'confirm', title: 'Confirm', summary: 'Read authoritative chain evidence before calling a payment complete.', source: 'https://nimiq.dev/learn/transactions' },
    { id: 'unlock', title: 'Unlock', summary: 'Only verified evidence changes the harbor and unlocks the next path.', source: 'https://nimiq.dev/mini-apps/' },
  ],
};

const ATLAS_SEASON_CONTENT = {
  id: 'launch-season-1',
  durationDays: 28,
  dailyRewardLunas: 80_000_000,
  totalRewardLunas: 8_000_000_000,
  tracks: ['explorer', 'builder'],
};

const ATLAS_SHOP_CONTENT = {
  items: [...ATLAS_MAINNET_SHOP_ITEMS, ATLAS_LOCAL_TEST_SHOP_ITEM],
};

export { ATLAS_ADVENTURE_CONTENT, ATLAS_KNOWLEDGE_CONTENT, ATLAS_SEASON_CONTENT, ATLAS_SHOP_CONTENT };

export async function createAtlasManifestBundle(): Promise<Array<AtlasPublishedManifest<unknown>>> {
  const definitions: Array<[AtlasManifestKind, number, unknown]> = [
    ['campaign', 2, ATLAS_CAMPAIGN_CONTENT],
    ['adventure', 1, ATLAS_ADVENTURE_CONTENT],
    ['knowledge', 1, ATLAS_KNOWLEDGE_CONTENT],
    ['season', 1, ATLAS_SEASON_CONTENT],
    ['shop', 1, ATLAS_SHOP_CONTENT],
  ];
  return Promise.all(definitions.map(([kind, version, content]) => createPublishedManifest(kind, version, '2026-08-25', content)));
}
