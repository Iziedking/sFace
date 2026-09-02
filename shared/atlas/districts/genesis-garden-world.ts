import type { AtlasEvent } from '../state';
import { GENESIS_GARDEN_MISSION } from './genesis-garden';
import type { AtlasLivingWorldDefinition, AtlasWorldEntity } from '../living-world';

const GENESIS_GARDEN_ENTITIES: readonly AtlasWorldEntity[] = [
  { id: 'harbor-keeper-mara', kind: 'resident', x: 26_000, y: 8_500, depth: 12, activeWhen: ['waiting', 'confirming', 'restored'] },
  { id: 'address-stone', kind: 'station', x: 11_000, y: 10_000, depth: 7, activeWhen: ['waiting', 'confirming', 'restored'] },
  { id: 'garden-path', kind: 'transport', x: 24_000, y: 10_500, depth: 5, activeWhen: ['restored'] },
  { id: 'garden-lantern', kind: 'light', x: 36_000, y: 6_000, depth: 14, activeWhen: ['restored'] },
  { id: 'garden-gatehouse', kind: 'building', x: 40_000, y: 10_000, depth: 9, activeWhen: ['waiting', 'confirming', 'restored'] },
];

export const GENESIS_GARDEN_WORLD: AtlasLivingWorldDefinition = Object.freeze({
  id: 'genesis-garden-world-v1', districtId: 'genesis-garden', mission: GENESIS_GARDEN_MISSION, entities: GENESIS_GARDEN_ENTITIES,
  chapter: { humanNeed: 'Mara needs one safe route restored before Pay Harbor can serve its first evening customer.', explorerAction: 'Ask, check, approve, confirm, and carry the lantern as the person the route serves.', builderRepair: 'Repair the provider and verification path without allowing the browser to invent authority.', proof: 'The harbor changes only after the reviewed request is matched to canonical confirmation evidence.', installation: 'Install the verified lantern route at the garden gate and reopen the harbor path.', teachBack: 'Tell the next player why an approval is a decision and confirmation is the proof.', scale: 'payment' as const, claim: 'Mara approved the request, so the lantern is paid for.', refutation: 'An approval records a decision. It does not record an arrival.', evidence: 'Canonical confirmation of the exact request the player reviewed.', },
});

export function genesisGardenRestoration(events: readonly AtlasEvent[]) {
  return events.some((event) => event.type === 'district-completed') ? 'restored' as const : 'waiting' as const;
}
