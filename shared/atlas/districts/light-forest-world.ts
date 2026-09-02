import type { AtlasEvent } from '../state';
import type { AtlasLivingWorldDefinition, AtlasWorldEntity } from '../living-world';
import type { AtlasMissionDefinition } from '../world';

const LIGHT_FOREST_MISSION: AtlasMissionDefinition = {
  id: 'light-forest-restoration-v1', districtId: 'light-forest', width: 2_400, height: 1_400,
  spawn: { x: 260, y: 1_080 }, relays: [{ id: 'forest-lamp-relay', x: 820, y: 760, knowledge: 'A clear payment request gives a person something safe to approve.' }],
  faults: [{ id: 'forest-shadow-route', x: 1_180, y: 900, radius: 120 }], rescue: { id: 'forest-gardener', name: 'Ife', x: 1_500, y: 720 }, gate: { id: 'forest-gate', x: 2_080, y: 420 }, requiredTools: ['scanner', 'relay-tether', 'shield-pulse'],
};
const LIGHT_FOREST_ENTITIES: readonly AtlasWorldEntity[] = [
  { id: 'forest-gardener', kind: 'resident', x: 1_500, y: 720, depth: 12, activeWhen: ['waiting', 'confirming', 'restored'] },
  { id: 'forest-lanterns', kind: 'light', x: 760, y: 520, depth: 14, activeWhen: ['restored'] },
  { id: 'forest-path', kind: 'transport', x: 1_180, y: 880, depth: 4, activeWhen: ['restored'] },
  { id: 'forest-workshop', kind: 'building', x: 1_620, y: 500, depth: 8, activeWhen: ['waiting', 'confirming', 'restored'] },
  { id: 'forest-stone', kind: 'prop', x: 820, y: 760, depth: 3, activeWhen: ['waiting', 'confirming', 'restored'] },
];

export const LIGHT_FOREST_WORLD: AtlasLivingWorldDefinition = Object.freeze({
  id: 'light-forest-world-v1', districtId: 'light-forest', mission: LIGHT_FOREST_MISSION, entities: LIGHT_FOREST_ENTITIES,
  chapter: { humanNeed: 'A forest community needs to verify the chain from a phone, with no server to trust and no room to store it.', explorerAction: 'Inspect the lamp request and approve only the exact route the gardener asked for.', builderRepair: 'Verify against a recursive zero-knowledge proof of the macro block header chain instead of trusting a remote answer or downloading the history.', proof: 'The forest lights change only when the server can match canonical payment evidence to the reviewed request.', installation: 'Install the verified route into the lamp relay and watch the paths illuminate.', teachBack: 'Explain how a proof of roughly half a megabyte can stand in for the whole chain, and why it stays that size as the chain grows.', scale: 'proof' as const, claim: 'To check the chain you must either trust a server or download all of it.', refutation: 'Neither trust nor bulk is required, and assuming they are is what centralizes a wallet.', evidence: 'A recursive zero-knowledge proof of the macro block header chain, roughly 400 to 500 kB and the same size however old the chain gets.', },
});

export function lightForestRestoration(events: readonly AtlasEvent[]) {
  return events.some((event) => event.type === 'district-completed') ? 'restored' as const : 'waiting' as const;
}
