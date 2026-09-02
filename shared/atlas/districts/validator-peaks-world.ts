import type { AtlasEvent } from '../state';
import type { AtlasLivingWorldDefinition, AtlasWorldEntity } from '../living-world';
import type { AtlasMissionDefinition } from '../world';

const VALIDATOR_PEAKS_MISSION: AtlasMissionDefinition = {
  id: 'validator-peaks-restoration-v1', districtId: 'validator-peaks', width: 2_400, height: 1_400,
  spawn: { x: 260, y: 1_060 }, relays: [{ id: 'peak-observer', x: 740, y: 700, knowledge: 'Validators help a network agree on the state everyone can inspect.' }],
  faults: [{ id: 'peak-signal-drift', x: 1_190, y: 850, radius: 120 }], rescue: { id: 'peak-observer-resident', name: 'Sade', x: 1_480, y: 650 }, gate: { id: 'peak-gate', x: 2_090, y: 360 }, requiredTools: ['scanner', 'relay-tether', 'shield-pulse'],
};
const VALIDATOR_PEAKS_ENTITIES: readonly AtlasWorldEntity[] = [
  { id: 'peak-observer-resident', kind: 'resident', x: 1_480, y: 650, depth: 12, activeWhen: ['waiting', 'confirming', 'restored'] },
  { id: 'peak-node', kind: 'building', x: 1_650, y: 480, depth: 9, activeWhen: ['waiting', 'confirming', 'restored'] },
  { id: 'peak-signal', kind: 'light', x: 1_900, y: 410, depth: 14, activeWhen: ['restored'] },
  { id: 'peak-trail', kind: 'transport', x: 1_160, y: 790, depth: 5, activeWhen: ['restored'] },
  { id: 'peak-relay', kind: 'station', x: 740, y: 700, depth: 7, activeWhen: ['waiting', 'confirming', 'restored'] },
];

export const VALIDATOR_PEAKS_WORLD: AtlasLivingWorldDefinition = Object.freeze({
  id: 'validator-peaks-world-v1', districtId: 'validator-peaks', mission: VALIDATOR_PEAKS_MISSION, entities: VALIDATOR_PEAKS_ENTITIES,
  chapter: { humanNeed: 'A mountain observatory needs to know which reported state the network actually agreed on.', explorerAction: 'Read the route and inspect the network context before approving the observatory request.', builderRepair: 'Show how many active slots voted a macro block through, rather than trusting the first validator that answered.', proof: 'The server derives the accepted state from canonical network reads, not a browser display.', installation: 'Install the verified signal at the observatory and make the peak readable again.', teachBack: 'Explain why one validator is only a witness and two thirds of active slots is an agreement.', scale: 'consensus' as const, claim: 'A validator reported this state, so this is the state.', refutation: 'One validator is a witness, not an agreement.', evidence: 'At least two thirds of active slots voting the macro block through Tendermint.', },
});

export function validatorPeaksRestoration(events: readonly AtlasEvent[]) {
  return events.some((event) => event.type === 'district-completed') ? 'restored' as const : 'waiting' as const;
}
