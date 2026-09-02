import type { AtlasLivingWorldDefinition, AtlasWorldEntity } from '../living-world';
import { LAST_LANTERN } from '../adventures/last-lantern';
import type { AtlasMissionDefinition } from '../world';

export const PAY_HARBOR_WORLD: AtlasLivingWorldDefinition = Object.freeze({
  id: 'pay-harbor-living-world',
  districtId: 'pay-harbor',
  mission: {
    id: LAST_LANTERN.id,
    districtId: 'pay-harbor',
    width: 2_400,
    height: 1_400,
    spawn: { x: 360, y: 760 },
    relays: [{ id: 'pay-harbor-checkpoint', x: 1_100, y: 620, knowledge: 'Ask, check, approve, confirm, then unlock.' }],
    faults: [{ id: 'stale-payment-route', x: 1_470, y: 790, radius: 100 }],
    rescue: { id: 'mara', name: 'Mara', x: 620, y: 700 },
    gate: { id: 'harbor-tower', x: 1_920, y: 500 },
    requiredTools: ['scanner', 'relay-tether', 'shield-pulse'],
  } satisfies AtlasMissionDefinition,
  chapter: {
    humanNeed: 'Mara needs a reliable payment route before the harbor market can open.',
    explorerAction: 'Ask what the shop needs, check the exact request, and approve only what you intended.',
    builderRepair: 'Keep provider access, account intent, exact Lunas, and server confirmation in separate steps.',
    proof: 'A provider lookup is only a lead; canonical chain evidence is the proof that changes the harbor.',
    installation: 'Install the confirmed lantern into the tower only after the server verifies the payment.',
    teachBack: 'Explain why a transaction hash is a receipt for asking and not a receipt for arriving.', scale: 'lookup' as const, claim: 'The wallet returned a transaction hash, so the payment went through.', refutation: 'A hash is a receipt for asking, not a receipt for arriving.', evidence: 'Network, sender, recipient, integer Luna value, success, canonical inclusion and confirmation depth all matching the order.',
  },
  entities: [
    { id: 'mara', kind: 'resident', x: 620, y: 700, depth: 12, activeWhen: ['waiting', 'confirming', 'restored'] },
    { id: 'waiting-lantern-stall', kind: 'building', x: 920, y: 640, depth: 6, activeWhen: ['waiting', 'confirming'] },
    { id: 'restored-lantern-stall', kind: 'building', x: 920, y: 640, depth: 6, activeWhen: ['restored'] },
    { id: 'harbor-ferry', kind: 'transport', x: 1_300, y: 950, depth: 4, activeWhen: ['restored'] },
    { id: 'confirmation-station', kind: 'station', x: 1_260, y: 620, depth: 8, activeWhen: ['confirming', 'restored'] },
    { id: 'harbor-tower', kind: 'building', x: 1_920, y: 500, depth: 10, activeWhen: ['waiting', 'confirming', 'restored'] },
    { id: 'lantern-light', kind: 'light', x: 1_920, y: 420, depth: 14, activeWhen: ['restored'] },
    { id: 'market-crate', kind: 'prop', x: 760, y: 860, depth: 2, activeWhen: ['waiting', 'confirming', 'restored'] },
  ] satisfies readonly AtlasWorldEntity[],
});
