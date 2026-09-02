import type { AtlasEvent } from '../state';
import type { AtlasLivingWorldDefinition, AtlasWorldEntity } from '../living-world';
import type { AtlasDistrictId } from '../types';
import type { AtlasMissionDefinition } from '../world';

const BEACON_CORE_MISSION: AtlasMissionDefinition = {
  id: 'beacon-core-finale-v1', districtId: 'beacon-core', width: 2_400, height: 1_400,
  spawn: { x: 260, y: 1_040 }, relays: [
    { id: 'beacon-genesis', x: 520, y: 560, knowledge: 'Genesis Garden taught careful inspection.' },
    { id: 'beacon-forest', x: 820, y: 560, knowledge: 'Light Forest taught capability boundaries.' },
    { id: 'beacon-harbor', x: 1_120, y: 560, knowledge: 'Pay Harbor taught consent and exact requests.' },
    { id: 'beacon-causeway', x: 1_420, y: 560, knowledge: 'Albatross Causeway taught canonical proof.' },
    { id: 'beacon-peaks', x: 1_720, y: 560, knowledge: 'Validator Peaks taught shared network state.' },
    { id: 'beacon-city', x: 2_020, y: 560, knowledge: 'Builder City taught resilient Mini App composition.' },
  ],
  faults: [{ id: 'beacon-authority-knot', x: 1_200, y: 900, radius: 140 }],
  rescue: { id: 'beacon-keeper', name: 'Beacon Keeper', x: 1_200, y: 760 }, gate: { id: 'beacon-installation', x: 1_200, y: 280 }, requiredTools: ['scanner', 'relay-tether', 'shield-pulse'],
};
const BEACON_CORE_ENTITIES: readonly AtlasWorldEntity[] = [
  { id: 'beacon-keeper', kind: 'resident', x: 1_200, y: 760, depth: 12, activeWhen: ['waiting', 'confirming', 'restored'] },
  { id: 'beacon-ring', kind: 'building', x: 1_200, y: 360, depth: 10, activeWhen: ['waiting', 'confirming', 'restored'] },
  { id: 'beacon-flow', kind: 'transport', x: 1_200, y: 680, depth: 5, activeWhen: ['restored'] },
  { id: 'beacon-light', kind: 'light', x: 1_200, y: 220, depth: 14, activeWhen: ['restored'] },
  { id: 'beacon-console', kind: 'station', x: 1_200, y: 900, depth: 7, activeWhen: ['waiting', 'confirming', 'restored'] },
];

export const BEACON_CORE_WORLD: AtlasLivingWorldDefinition & { requiredDistricts: readonly AtlasDistrictId[] } = Object.freeze({
  id: 'beacon-core-world-v1', districtId: 'beacon-core', mission: BEACON_CORE_MISSION, entities: BEACON_CORE_ENTITIES,
  requiredDistricts: ['genesis-garden', 'light-forest', 'pay-harbor', 'albatross-causeway', 'validator-peaks', 'builder-city'] as const,
  chapter: { humanNeed: 'The Beacon Keeper needs six reliable systems composed into one shared route that everyone can understand.', explorerAction: 'Use each district lesson to inspect the final route as a person who needs it to work.', builderRepair: 'Compose every capability without collapsing user intent, server replay, and chain proof into one guess.', proof: 'Each district seal and sourced lesson must be present before the Beacon can be installed.', installation: 'Install the six verified systems into Beacon Core and light the shared route.', teachBack: 'Teach another player how six district seals compose into one route, and what each seal proves.', scale: 'composition' as const, claim: 'Six working parts make a working whole.', refutation: 'Composition can still collapse user intent, server replay and chain proof into a single guess.', evidence: 'All six district seals present, each carrying its sourced lesson, before the shared route lights.', },
});

export function canInstallBeaconCore(districtSeals: readonly AtlasDistrictId[]): boolean {
  const seals = new Set(districtSeals);
  return BEACON_CORE_WORLD.requiredDistricts.every((districtId) => seals.has(districtId));
}

export function beaconCoreRestoration(events: readonly AtlasEvent[]) {
  const connected = new Set(events.filter((event) => event.type === 'relay-connected').map((event) => event.targetId));
  const allRelaysConnected = BEACON_CORE_MISSION.relays.every((relay) => connected.has(relay.id));
  if (!allRelaysConnected) return 'waiting' as const;
  const safe = events.some((event) => event.type === 'fault-shielded' && event.targetId === 'beacon-authority-knot');
  const keeperRescued = events.some((event) => event.type === 'rescued' && event.targetId === 'beacon-keeper');
  if (!safe || !keeperRescued) return 'confirming' as const;
  return events.some((event) => event.type === 'district-completed' && event.targetId === 'beacon-installation') ? 'restored' as const : 'confirming' as const;
}
