import type { AtlasEvent } from '../state';
import type { AtlasLivingWorldDefinition, AtlasWorldEntity } from '../living-world';
import type { AtlasMissionDefinition } from '../world';

const BUILDER_CITY_MISSION: AtlasMissionDefinition = {
  id: 'builder-city-restoration-v1', districtId: 'builder-city', width: 2_400, height: 1_400,
  spawn: { x: 260, y: 1_040 }, relays: [{ id: 'city-workshop-relay', x: 780, y: 700, knowledge: 'Good Mini Apps make intent, capability, and evidence visible.' }],
  faults: [{ id: 'city-provider-knot', x: 1_240, y: 840, radius: 120 }], rescue: { id: 'city-maintainer', name: 'Tomi', x: 1_520, y: 650 }, gate: { id: 'city-gate', x: 2_080, y: 360 }, requiredTools: ['scanner', 'relay-tether', 'shield-pulse'],
};
const BUILDER_CITY_ENTITIES: readonly AtlasWorldEntity[] = [
  { id: 'city-maintainer', kind: 'resident', x: 1_520, y: 650, depth: 12, activeWhen: ['waiting', 'confirming', 'restored'] },
  { id: 'city-workshop', kind: 'building', x: 1_620, y: 470, depth: 9, activeWhen: ['waiting', 'confirming', 'restored'] },
  { id: 'city-deploy-lane', kind: 'transport', x: 1_200, y: 820, depth: 5, activeWhen: ['restored'] },
  { id: 'city-console', kind: 'station', x: 780, y: 700, depth: 7, activeWhen: ['waiting', 'confirming', 'restored'] },
  { id: 'city-green-light', kind: 'light', x: 1_900, y: 410, depth: 14, activeWhen: ['restored'] },
];

export const BUILDER_CITY_WORLD: AtlasLivingWorldDefinition = Object.freeze({
  id: 'builder-city-world-v1', districtId: 'builder-city', mission: BUILDER_CITY_MISSION, entities: BUILDER_CITY_ENTITIES,
  chapter: { humanNeed: 'A city of maintainers needs a Mini App whose success screen means something.', explorerAction: 'Use the finished route as a person: understand the request, approve it, and watch the consequence.', builderRepair: 'Keep authority on the server, and let the browser display a verified result rather than decide one.', proof: 'A successful integration is reproducible from reviewed inputs and canonical evidence.', installation: 'Install the repaired route into the city workshop and reopen its deployment lane.', teachBack: 'Explain why a browser cannot be its own authority, and where authority actually lives.', scale: 'authority' as const, claim: 'My Mini App displayed success, so the integration works.', refutation: 'A browser cannot be its own authority over what happened on a network.', evidence: 'Server-side verification against canonical reads, reproducible from the reviewed inputs.', },
});

export function builderCityRestoration(events: readonly AtlasEvent[]) {
  return events.some((event) => event.type === 'district-completed') ? 'restored' as const : 'waiting' as const;
}
