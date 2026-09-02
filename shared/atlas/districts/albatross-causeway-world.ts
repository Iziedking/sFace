import type { AtlasEvent } from '../state';
import type { AtlasLivingWorldDefinition, AtlasWorldEntity } from '../living-world';
import type { AtlasMissionDefinition } from '../world';

const ALBATROSS_CAUSEWAY_MISSION: AtlasMissionDefinition = {
  id: 'albatross-causeway-restoration-v1', districtId: 'albatross-causeway', width: 2_400, height: 1_400,
  spawn: { x: 240, y: 980 }, relays: [{ id: 'causeway-checkpoint', x: 760, y: 680, knowledge: 'A network can be fast and still require careful confirmation.' }],
  faults: [{ id: 'causeway-detour', x: 1_120, y: 820, radius: 120 }], rescue: { id: 'causeway-ferryman', name: 'Kojo', x: 1_460, y: 680 }, gate: { id: 'causeway-gate', x: 2_060, y: 360 }, requiredTools: ['scanner', 'relay-tether', 'shield-pulse'],
};
const ALBATROSS_CAUSEWAY_ENTITIES: readonly AtlasWorldEntity[] = [
  { id: 'causeway-ferryman', kind: 'resident', x: 1_460, y: 680, depth: 12, activeWhen: ['waiting', 'confirming', 'restored'] },
  { id: 'causeway-bridge', kind: 'transport', x: 1_170, y: 760, depth: 5, activeWhen: ['restored'] },
  { id: 'causeway-checkpoint', kind: 'station', x: 760, y: 680, depth: 7, activeWhen: ['waiting', 'confirming', 'restored'] },
  { id: 'causeway-beacon', kind: 'light', x: 1_820, y: 410, depth: 14, activeWhen: ['restored'] },
  { id: 'causeway-house', kind: 'building', x: 1_520, y: 420, depth: 8, activeWhen: ['waiting', 'confirming', 'restored'] },
];

export const ALBATROSS_CAUSEWAY_WORLD: AtlasLivingWorldDefinition = Object.freeze({
  id: 'albatross-causeway-world-v1', districtId: 'albatross-causeway', mission: ALBATROSS_CAUSEWAY_MISSION, entities: ALBATROSS_CAUSEWAY_ENTITIES,
  chapter: { humanNeed: 'A ferryman needs to know when a crossing is settled, not just when it looked quick.', explorerAction: 'Check the recipient and amount before approving a fast route across the causeway.', builderRepair: 'Distinguish the block that carried a transaction from the macro block that finalized it, and never report the first as the second.', proof: 'Only matching network, sender, recipient, integer value, and confirmation depth count as proof.', installation: 'Install the verified crossing signal and reopen the bridge for the community.', teachBack: 'Explain why a micro block is fast but not final, and what a macro block adds.', scale: 'block' as const, claim: 'A block carrying the crossing appeared in under a second, so it is settled.', refutation: 'A micro block is fast. Fast is not final.', evidence: 'A macro block closing the batch, which finalizes every transaction in it.', },
});

export function albatrossCausewayRestoration(events: readonly AtlasEvent[]) {
  return events.some((event) => event.type === 'district-completed') ? 'restored' as const : 'waiting' as const;
}
